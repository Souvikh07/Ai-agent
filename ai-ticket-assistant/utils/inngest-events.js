import { inngest } from "../inngest/client.js";

export const sendInngestEvent = async (event) => {
  if (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1") {
    console.error(
      "Inngest event skipped: set INNGEST_EVENT_KEY in production or INNGEST_DEV=1 locally"
    );
    return;
  }

  try {
    await inngest.send(event);
    console.log(`Inngest event sent: ${event.name}`);
  } catch (error) {
    console.error("Inngest event failed:", error.message);
  }
};
