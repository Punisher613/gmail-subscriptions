import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Anthropic API key not configured" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const { emails } = await req.json();
    if (!emails || !emails.length) {
      return new Response(JSON.stringify({ items: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process each email in parallel with Claude Haiku
    const results = await Promise.all(
      emails.map(async (email: any) => {
        try {
          const prompt = `Analyze this email and determine if it contains a receipt, invoice, payment confirmation, or subscription charge.

If it IS a financial/receipt email, extract the details and return ONLY a JSON object:
{
  "is_financial": true,
  "vendor": "Company or store name",
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "note": "Brief description (2-4 words max, e.g. 'Monthly subscription', 'Online order')",
  "category": "paid"
}

For category, use:
- "paid" for completed purchases, order confirmations, payment receipts
- "subscriptions" for recurring subscription charges, membership renewals
- "upcoming" for unpaid invoices, payment reminders, upcoming charges

If the email is NOT financial (newsletters, marketing, shipping updates without prices, etc.), return ONLY:
{ "is_financial": false }

Email subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Body:
${email.body_text}

Return ONLY the JSON object, no other text.`;

          const claudeRes = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                messages: [{ role: "user", content: prompt }],
              }),
            }
          );

          const claudeData = await claudeRes.json();
          if (claudeData.error) {
            console.error("Claude error:", claudeData.error);
            return null;
          }

          const text = claudeData.content?.[0]?.text || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

          if (!parsed.is_financial) return null;

          return {
            vendor: parsed.vendor || "",
            date: parsed.date || "",
            amount: parseFloat(parsed.amount) || 0,
            note: parsed.note || "",
            category: parsed.category || "paid",
            source_subject: email.subject,
            message_id: email.message_id,
          };
        } catch (err) {
          console.error("Error parsing email:", email.subject, err);
          return null;
        }
      })
    );

    // Filter out nulls (non-financial or failed parses)
    const items = results.filter((r: any) => r !== null);

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
