import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";

export default function TicketDetailsPage() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const token = localStorage.getItem("token");

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    const fetchTicket = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SERVER_URL}/tickets/${id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        const data = await res.json();
        if (res.ok) {
          const nextTicket = data.ticket;
          if (!cancelled) {
            setTicket(nextTicket);
            const aiReady =
              nextTicket.priority ||
              nextTicket.helpfulNotes ||
              nextTicket.relatedSkills?.length > 0;
            setProcessing(!aiReady && attempts < maxAttempts);
          }
          return nextTicket;
        }
        if (!cancelled) {
          alert(data.message || "Failed to fetch ticket");
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          alert("Something went wrong");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
      return null;
    };

    const poll = async () => {
      const nextTicket = await fetchTicket();
      const aiReady =
        nextTicket?.priority ||
        nextTicket?.helpfulNotes ||
        nextTicket?.relatedSkills?.length > 0;

      if (!aiReady && attempts < maxAttempts) {
        attempts += 1;
        setTimeout(poll, 3000);
      } else if (!cancelled) {
        setProcessing(false);
      }
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [id, token]);

  if (loading)
    return <div className="text-center mt-10">Loading ticket details...</div>;
  if (!ticket) return <div className="text-center mt-10">Ticket not found</div>;

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Ticket Details</h2>

      {processing && (
        <div className="alert alert-info mb-4">
          AI is analyzing your ticket — this usually takes 10–20 seconds...
        </div>
      )}

      <div className="card bg-gray-800 shadow p-4 space-y-4">
        <h3 className="text-xl font-semibold">{ticket.title}</h3>
        <p>{ticket.description}</p>

        {ticket.status && (
          <>
            <div className="divider">Metadata</div>
            <p>
              <strong>Status:</strong> {ticket.status}
            </p>
            {ticket.priority && (
              <p>
                <strong>Priority:</strong> {ticket.priority}
              </p>
            )}

            {ticket.relatedSkills?.length > 0 && (
              <p>
                <strong>Related Skills:</strong>{" "}
                {ticket.relatedSkills.join(", ")}
              </p>
            )}

            {ticket.helpfulNotes && (
              <div>
                <strong>Helpful Notes:</strong>
                <div className="prose max-w-none rounded mt-2">
                  <ReactMarkdown>{ticket.helpfulNotes}</ReactMarkdown>
                </div>
              </div>
            )}

            {!ticket.priority &&
              !ticket.helpfulNotes &&
              !ticket.relatedSkills?.length &&
              !processing && (
                <p className="text-sm text-gray-400">
                  AI analysis is not available for this ticket yet.
                </p>
              )}

            {ticket.assignedTo && (
              <p>
                <strong>Assigned To:</strong>{" "}
                {typeof ticket.assignedTo === "object"
                  ? ticket.assignedTo.email
                  : ticket.assignedTo}
              </p>
            )}

            {ticket.createdAt && (
              <p className="text-sm text-gray-500 mt-2">
                Created At: {new Date(ticket.createdAt).toLocaleString()}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
