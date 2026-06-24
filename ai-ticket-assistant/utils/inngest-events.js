import { inngest } from "../inngest/client.js";

export const sendInngestEvent = async (event) => {
  if (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1") {
    console.warn("Inngest event skipped: configure INNGEST_EVENT_KEY or INNGEST_DEV=1");
    return;
  }

  try {
    await inngest.send(event);
  } catch (error) {
    console.warn("Inngest event failed (non-blocking):", error.message);
  }
};
