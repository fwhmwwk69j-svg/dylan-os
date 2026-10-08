import { useEffect, useState } from "react";
export function useWorkspacePresence() {
  const [otherTabs, setOtherTabs] = useState(0);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("dylan-os-presence");
    const peers = new Map<string, number>();
    const id = crypto.randomUUID();
    const presence = () =>
      channel.postMessage({ id, type: "presence", hello: true });
    const leave = () => channel.postMessage({ id, type: "leave" });
    channel.onmessage = (e) => {
      if (e.data?.id === id) return;
      if (e.data?.type === "leave") peers.delete(e.data.id);
      else if (e.data?.type === "presence") {
        peers.set(e.data.id, Date.now());
        if (e.data.hello) channel.postMessage({ id, type: "presence" });
      }
      setOtherTabs(peers.size);
    };
    presence();
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", presence);
    const timer = setInterval(() => {
      for (const [peer, last] of peers)
        if (Date.now() - last > 15000) peers.delete(peer);
      setOtherTabs(peers.size);
      channel.postMessage({ id, type: "presence" });
    }, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", presence);
      leave();
      channel.close();
    };
  }, []);
  return otherTabs;
}
