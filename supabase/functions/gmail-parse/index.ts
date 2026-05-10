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
          console.log(`Parsing email: "${email.subject}" from ${email.from}, body length: ${email.body_text?.length || 0}`);

          const bodyContent = email.body_text && email.body_text.length > 10
            ? email.body_text
            : "(Email body could not be extracted)";

          const prompt = `You are analyzing an email to find financial transactions. Be GENEROUS in classifying — if the email mentions any dollar amount, price, charge, payment, order, or subscription, classify it as financial.

If it contains ANY financial information (receipt, invoice, payment, order, charge, subscription, bill), extract details and return ONLY a JSON object:
{
  "is_financial": true,
  "vendor": "Company or store name",
  "date": "YYYY-MM-DD",
  "amount": 0.00,
  "note": "Brief description (2-4 words max)",
  "category": "paid"
}

For category:
- "paid" for completed purchases, order confirmations, payment receipts
- "subscriptions" for recurring subscription charges, membership renewals
- "upcoming" for unpaid invoices, payment reminders

If the email has absolutely NO financial content (pure newsletters, social notifications, etc.), return:
{ "is_financial": false }

Email subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Body:
${bodyContent}

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
            console.error("Claude error for:", email.subject, claudeData.error);
            return { _debug_error: 'Claude API: ' + (claudeData.error.message || JSON.stringify(claudeData.error)), _debug_subject: email.subject };
          }

          const text = claudeData.content?.[0]?.text || "{}";
          console.log(`Claude response for "${email.subject}":`, text);
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

          if (!parsed.is_financial) {
            console.log(`Not financial: "${email.subject}"`);
            return { _debug_not_financial: true, _debug_subject: email.subject, _debug_claude: text, _debug_body_preview: (email.body_text || '').substring(0, 200) };
          }

          return {
            vendor: parsed.vendor || "",
            date: parsed.date || "",
            amount: parseFloat(parsed.amount) || 0,
            note: parsed.note || "",
            category: parsed.category || "paid",
            source_subject: email.subject,
            message_id: email.message_id,
            body_html: email.body_html || "",
          };
        } catch (err) {
          console.error("Error parsing email:", email.subject, err);
          return { _debug_error: err.message, _debug_subject: email.subject };
        }
      })
    );

    // Separate debug info from real items
    const items = results.filter((r: any) => r !== null && !r._debug_error && !r._debug_not_financial);
    const debug = results.map((r: any, i: number) => {
      if (r === null) return { subject: emails[i]?.subject, result: 'null' };
      if (r._debug_error) return { subject: r._debug_subject, error: r._debug_error };
      if (r._debug_not_financial) return { subject: r._debug_subject, result: 'not_financial', claude_said: r._debug_claude, body_preview: r._debug_body_preview };
      return { subject: r.source_subject, result: 'financial', vendor: r.vendor };
    });

    return new Response(JSON.stringify({ items, debug }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
