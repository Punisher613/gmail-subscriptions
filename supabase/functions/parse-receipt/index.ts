import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const { image, filename } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Extract base64 data and media type from data URL
    const match = image.match(/^data:(.*?);base64,(.*)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Invalid image format" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const mediaType = match[1];
    const base64Data = match[2];

    // Determine if it's an image or PDF
    const isImage = mediaType.startsWith("image/");

    // Build Claude API request
    const content: any[] = [];

    if (isImage) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64Data,
        },
      });
    } else {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64Data,
        },
      });
    }

    content.push({
      type: "text",
      text: `Analyze this receipt/invoice image and extract the following information. Return ONLY a JSON object with these fields:
{
  "vendor": "Store or company name",
  "date": "YYYY-MM-DD format",
  "amount": 0.00,
  "note": "Brief description of what was purchased (1-2 words max)",
  "category": "paid"
}

For category, use:
- "paid" for completed purchases/receipts
- "subscriptions" if it's clearly a recurring subscription charge
- "upcoming" if it appears to be an unpaid invoice or future charge

Return ONLY the JSON, no other text.`,
    });

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: content,
          },
        ],
      }),
    });

    const claudeData = await claudeResponse.json();

    if (claudeData.error) {
      return new Response(
        JSON.stringify({ error: claudeData.error.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Extract JSON from Claude's response
    const responseText = claudeData.content?.[0]?.text || "{}";
    let parsed;
    try {
      // Try to extract JSON from the response (in case there's surrounding text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      parsed = { vendor: "", date: "", amount: 0, note: "", category: "paid" };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
