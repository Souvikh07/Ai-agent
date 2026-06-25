import { inngest } from "../client.js";
import Ticket from "../../models/ticket.js";
import User from "../../models/user.js";
import { NonRetriableError } from "inngest";
import { sendMail } from "../../utils/mailer.js";
import analyzeTicket from "../../utils/ai.js";

export const onTicketCreated = inngest.createFunction(
  { id: "on-ticket-created", retries: 2, triggers: [{ event: "ticket/created" }] },
  async ({ event, step }) => {
    try {
      const { ticketId } = event.data;

      //fetch ticket from DB
      const ticket = await step.run("fetch-ticket", async () => {
        const ticketObject = await Ticket.findById(ticketId);
        if (!ticketObject) {
          throw new NonRetriableError("Ticket not found");
        }
        return ticketObject;
      });

      await step.run("update-ticket-status", async () => {
        await Ticket.findByIdAndUpdate(ticket._id, { status: "TODO" });
      });

      const relatedskills = await step.run("ai-processing", async () => {
        const aiResponse = await analyzeTicket(ticket);
        const priority = ["low", "medium", "high"].includes(aiResponse.priority)
          ? aiResponse.priority
          : "medium";
        const helpfulNotes = aiResponse.helpfulNotes;
        const skills = aiResponse.relatedSkills ?? [];

        await Ticket.findByIdAndUpdate(ticket._id, {
          priority,
          helpfulNotes,
          status: "IN_PROGRESS",
          relatedSkills: skills,
        });

        return skills;
      });

      const moderator = await step.run("assign-moderator", async () => {
        let user = null;
        if (relatedskills?.length > 0) {
          user = await User.findOne({
            role: "moderator",
            skills: {
              $elemMatch: {
                $regex: relatedskills.join("|"),
                $options: "i",
              },
            },
          });
        }
        if (!user) {
          user = await User.findOne({
            role: "admin",
          });
        }
        await Ticket.findByIdAndUpdate(ticket._id, {
          assignedTo: user?._id || null,
        });
        return user;
      });

      await step.run("send-email-notification", async () => {
        if (!moderator) return;
        try {
          const finalTicket = await Ticket.findById(ticket._id);
          await sendMail(
            moderator.email,
            "Ticket Assigned",
            `A new ticket is assigned to you ${finalTicket.title}`
          );
        } catch (error) {
          console.error("Email notification failed:", error.message);
        }
      });

      return { success: true };
    } catch (err) {
      console.error("❌ Error running the step", err.message);
      return { success: false };
    }
  }
);
