# Gmail Subscriptions Viewer

## Goal
Scan Gmail inbox and display a list of subscriptions/newsletters with receipts, dashboard reports, and subscription management.

## What's Already Set Up
- Gmail MCP server installed: `@gongrzhe/server-gmail-autoauth-mcp`
  - Package location: `/usr/local/lib/node_modules/@gongrzhe/server-gmail-autoauth-mcp/dist/index.js`
- OAuth credentials saved at: `~/.gmail-mcp/`
  - `gcp-oauth.keys.json` — Google Cloud OAuth keys (project: gotham-493514)
  - `credentials.json` — Auth tokens (includes refresh token)
- MCP server configured in: `~/.claude/settings.json`

## Scan Workflow (for future Claude sessions)
When the user says "scan for new receipts":

1. **Search Gmail** for receipts/invoices after the last scan date (shown in the header of index.html as `#scan-date`)
   - Query: `subject:(receipt OR invoice OR payment OR charged) after:YYYY/MM/DD`
   - Also check: `(billing OR "order confirmation" OR "payment received") after:YYYY/MM/DD`

2. **For each new receipt found**:
   - Read the email to extract: vendor name, amount, date, receipt number
   - If it has a PDF attachment, download it to `receipts/` folder
   - Determine if it belongs to an existing subscription or is a new charge

3. **Update index.html**:
   - Add the receipt to the correct month accordion in the Paid History section
   - If it's a known subscription, update the `data-nextbill` on the recurring row (charge date + 1 month)
   - If it's a new vendor, add it to the appropriate section
   - Update the `#scan-date` text to today's date

4. **Key data attributes on paid rows**:
   - `data-type="paid"` — receipt type
   - `data-amount="XX.XX"` — dollar amount
   - `data-pdf="receipts/filename.pdf"` — path to downloaded PDF
   - `data-id="vendor-datekey"` — unique ID for localStorage

5. **Key data attributes on subscription rows**:
   - `data-type="recurring"` — subscription type
   - `data-sub="true"` — marks it as a subscription
   - `data-monthly="XX.XX"` — known monthly price
   - `data-nextbill="YYYY-MM-DD"` — next charge date
   - `data-id="sub-vendorname"` — unique ID

## Current Status
- App is fully functional at `index.html`
- Last scan: May 7, 2026
- Gmail account: saul@gothaminjury.com

## Known Subscriptions (for matching receipts)
- Anthropic Claude Pro — `sub-anthropic` — charges ~30th of month
- Agent Opus Max Plan — `sub-agent-opus` — charges ~22nd of month
- Arcads Starter — `sub-arcads` — charges ~16th of month
- Google Workspace — `sub-google-workspace` — charges ~7th of month
- Google Workspace AI — `sub-google-ai` — charges ~1st of month
- Verizon Wireless — `sub-verizon` — charges ~24th of month
- Apple Creator Studio — `sub-apple` — trial until Jul 27
- Higgsfield — `sub-higgsfield` — monthly, user-entered price
