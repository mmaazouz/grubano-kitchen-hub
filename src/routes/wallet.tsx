import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { QrCode, MessageCircle, Share2, MapPin } from "lucide-react";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
  head: () => ({ meta: [{ title: "Grubano — Client Wallet" }] }),
});

function WalletPage() {
  return (
    <FeaturePage title="Client Wallet" subtitle="PWA preview · what customers see" badge="QR-based">
      <Card className="!bg-navy !text-navy-foreground">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-primary">Loyalty wallet</p>
            <p className="mt-1 text-2xl font-bold">487 pts</p>
            <p className="text-[11px] text-navy-foreground/60">Silver tier · 113 to Gold</p>
          </div>
          <div className="grid h-16 w-16 place-items-center rounded-xl bg-white text-navy">
            <QrCode size={36} />
          </div>
        </div>
      </Card>

      <SectionTitle>Live order tracking</SectionTitle>
      <Card>
        <div className="flex items-center gap-3">
          <MapPin size={16} className="text-primary" />
          <p className="text-sm font-semibold">Rider 4 min away</p>
        </div>
        <div className="mt-3 flex gap-1.5">
          {["Received", "Cooking", "Out", "Delivered"].map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= 2 ? "bg-primary" : "bg-muted"}`} />
              <p className="mt-1 text-center text-[9px] font-semibold text-muted-foreground">{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle>Chat with kitchen</SectionTitle>
      <Card>
        <div className="space-y-2">
          <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-[12px] text-primary-foreground">Extra sauce please 🙏</div>
          <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-[12px]">On it! Adding extra pesto.</div>
        </div>
        <div className="mt-3 flex gap-2">
          <input className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm outline-none" placeholder="Message…" />
          <button className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground"><MessageCircle size={15} /></button>
        </div>
      </Card>

      <SectionTitle>Refer a friend</SectionTitle>
      <Card className="flex items-center justify-between !p-3">
        <div>
          <p className="text-sm font-semibold">grubano.app/r/sarah</p>
          <p className="text-[11px] text-muted-foreground">+100 pts per signup</p>
        </div>
        <button className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Share2 size={15} /></button>
      </Card>
    </FeaturePage>
  );
}
