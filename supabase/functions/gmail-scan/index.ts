import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Decode base64url (Gmail uses URL-safe base64)
function decodeBase64Url(str: string): string {
  // Replace URL-safe chars and add padding
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

// Extract plain text from a Gmail message payload
function extractText(payload: any): string {
  if (!payload) return "";

  // Single-part message
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — recurse into parts
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fall back to text/html stripped of tags
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const text = extractText(part);
        if (text) return text;
      }
    }
  }

  return "";
}

// Extract HTML from a Gmail message payload (for receipt display)
function extractHtml(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.parts) {
        const html = extractHtml(part);
        if (html) return html;
      }
    }
  }
  return "";
}

// Get header value from Gmail message
function getHeader(headers: any[], name: string): string {
  const h = headers?.find(
    (h: any) => h.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { access_token, refresh_token } = await req.json();

    let token = access_token;

    // If no access token, try to refresh
    if (!token && refresh_token) {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({ error: "Google OAuth not configured" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const refreshData = await refreshRes.json();
      if (refreshData.error) {
        return new Response(
          JSON.stringify({
            error: "Token refresh failed: " + refreshData.error_description,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 401,
          }
        );
      }
      token = refreshData.access_token;
    }

    if (!token) {
      return new Response(
        JSON.stringify({ error: "No access token available" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Search Gmail for receipt-like emails (last 6 months)
    // Don't exclude promotions — many real receipts (Apple, etc.) land there
    const query =
      '(subject:(receipt OR invoice OR "order confirmation" OR payment OR subscription OR "billing statement" OR "your order" OR purchase OR renewal OR charged OR transaction OR "amount due" OR refund OR "payment received" OR "auto-pay" OR "monthly statement" OR "annual plan" OR upgrade) OR from:(noreply OR no-reply OR receipt OR invoice OR billing OR payments OR statements OR store OR orders OR apple OR google OR amazon OR paypal OR stripe OR shopify OR venmo OR cashapp OR zelle OR netflix OR spotify OR hulu OR disney OR adobe OR microsoft OR uber OR lyft OR doordash OR grubhub OR instacart OR walmart OR target OR bestbuy OR costco)) newer_than:6m';
    const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
      query
    )}&maxResults=50`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return new Response(
        JSON.stringify({ error: "Gmail search failed", detail: errText }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: searchRes.status,
        }
      );
    }

    const searchData = await searchRes.json();
    const messageIds = (searchData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      return new Response(JSON.stringify({ emails: [], token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch message details in parallel batches of 10
    const emails: any[] = [];
    for (let i = 0; i < messageIds.length; i += 10) {
      const batch = messageIds.slice(i, i + 10);
      const results = await Promise.all(
        batch.map((id: string) =>
          fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          ).then((r) => r.json())
        )
      );

      for (const msg of results) {
        if (!msg.payload) continue;
        const headers = msg.payload.headers || [];
        const subject = getHeader(headers, "Subject");
        const from = getHeader(headers, "From");
        const date = getHeader(headers, "Date");

        // Extract text body, truncate to 2000 chars to save tokens
        let bodyText = extractText(msg.payload);
        if (bodyText.length > 2000) bodyText = bodyText.substring(0, 2000);

        // Extract HTML body for receipt display
        let bodyHtml = extractHtml(msg.payload);
        if (bodyHtml.length > 50000) bodyHtml = bodyHtml.substring(0, 50000);

        emails.push({
          message_id: msg.id,
          subject,
          from,
          date,
          body_text: bodyText,
          body_html: bodyHtml,
        });
      }
    }

    // Return the refreshed token too so frontend can use it
    return new Response(JSON.stringify({ emails, token }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
