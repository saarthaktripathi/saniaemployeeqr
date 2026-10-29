import { QrCode, ShieldCheck, Clock } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { VerifyLookupForm } from "@/components/verification/lookup-form";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-xs font-semibold tracking-wider text-teal-700 uppercase">Public employee verification</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
            Confirm a Sania Job Bowl employee credential
          </h1>
          <p className="mt-4 max-w-xl text-ink-muted">
            Scan the QR code on a Sania Job Bowl employee ID with your phone camera, or paste the verification link below. You will see the
            current status of that record in our HR system.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              { icon: QrCode, title: "Scan or paste", text: "Every ID carries its own unique, unguessable verification link." },
              { icon: Clock, title: "Live status", text: "Results reflect the record at the moment you check — including deactivations and revocations." },
              { icon: ShieldCheck, title: "Privacy first", text: "Only company-approved fields are shown. No contact details are ever displayed." },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 rounded-lg bg-teal-50 p-2 text-teal-700">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold text-ink">{title}</span>
                  <span className="text-ink-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Card className="p-6">
          <h2 className="font-semibold text-ink">Verify with a link</h2>
          <p className="mt-1 text-sm text-ink-muted">Paste the full verification link printed under the QR code.</p>
          <VerifyLookupForm />
          <p className="mt-6 border-t border-border pt-4 text-xs text-ink-subtle">
            A verification result confirms the current state of the record in the company system. It does not by itself prove the identity of the
            person presenting the ID — compare the name with a photo ID where identity matters.
          </p>
        </Card>
      </div>
    </div>
  );
}
