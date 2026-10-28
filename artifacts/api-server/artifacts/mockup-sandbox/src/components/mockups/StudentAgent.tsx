import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export default function StudentAgent() {
  const [msg, setMsg] = useState("");
  const [chat, setChat] = useState<{ role: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!msg.trim()) return;
    const userMsg = msg;
    setMsg("");
    setChat((c) => [...c, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();
      setChat((c) => [...c, { role: "agent", text: data.reply }]);
    } catch {
      setChat((c) => [...c, { role: "agent", text: "Error talking to server." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Study Buddy</h1>
        <Button onClick={() => (window.location.href = "/api/auth/google")}>
          Connect Google
        </Button>
      </div>
      <Card className="h-[400px] overflow-y-auto">
        <CardContent className="p-4 space-y-2">
          {chat.map((c, i) => (
            <div
              key={i}
              className={c.role === "user" ? "text-right" : "text-left"}
            >
              <span className="inline-block bg-muted p-2 rounded-lg">
                {c.text}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Ask for a hint..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button onClick={send} disabled={loading}>
          {loading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
