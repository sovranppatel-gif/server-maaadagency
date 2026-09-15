/**
 * Local harness that replays a WhatsApp conversation against the webhook,
 * exactly as Meta would deliver it. Useful for exercising the intake bot
 * without a live WhatsApp Business account.
 *
 *   node --env-file=.env src/seed/simulate-whatsapp.js [phone]
 */
const BASE = process.env.SIM_BASE_URL ?? "http://localhost:5000";
const PHONE = process.argv[2] ?? "919000000123";
const PROFILE_NAME = "Simulated Customer";

const ANSWERS = [
  "hi",              // opens the thread, triggers the welcome message
  "4",               // service: UI/UX Design (option 4)
  "Mobile app redesign for our delivery service",
  "Arjun Desai",
  "Speedy Logistics",
  "We need a cleaner order-tracking flow and a refreshed visual style.",
  "https://www.swiggy.com",
  "2026-11-30",
  "Rs 80,000",
  "Will share the brand kit shortly",
];

function payload(text, index) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "SIMULATED_WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "919999999999", phone_number_id: "SIMULATED_PHONE_ID" },
              contacts: [{ profile: { name: PROFILE_NAME }, wa_id: PHONE }],
              messages: [
                {
                  from: PHONE,
                  id: `wamid.SIM${Date.now()}${index}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function main() {
  console.log(`Simulating a WhatsApp conversation from ${PHONE}\n`);

  for (const [index, text] of ANSWERS.entries()) {
    const res = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(text, index)),
    });
    console.log(`  [${index + 1}/${ANSWERS.length}] customer: ${text}  ->  ${res.status}`);
    // Let the server finish its async processing before the next turn.
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log("\nConversation replayed. Check the inbox and Leads list for the captured requirement.");
}

main().catch((err) => {
  console.error("Simulation failed:", err.message);
  process.exit(1);
});
