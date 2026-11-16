import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/server/db/client";
import { requirePageActor } from "@/server/auth/session";
import { getEmployee } from "@/server/services/employees";
import { AppError } from "@/lib/errors";
import { CardExport } from "@/components/cards/card-export";
import { VisitingCardSvg, visitingCardData } from "@/components/cards/visiting-card-svg";

export const metadata: Metadata = { title: "Visiting card" };

export default async function VisitingCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, ctx } = await requirePageActor("employee:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const employee = await getEmployee(db, actor, id, ctx).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-5 flex items-center justify-between">
        <Link href={`/employees/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Back to employee
        </Link>
      </div>
      <CardExport filename={`${employee.employeeCode}-visiting-card`} sides={["Card"]} noun="Visiting card" className="flex justify-center">
        <VisitingCardSvg data={visitingCardData(employee)} className="h-auto w-full max-w-[640px] drop-shadow-xl print:w-[88.9mm] print:max-w-none print:drop-shadow-none" />
      </CardExport>
      <p className="no-print mt-3 text-center text-xs text-ink-subtle">
        Uses the employee&apos;s official email, contact number and work location; company details fill any that are missing. PNG and PDF are generated on
        your device.
      </p>
    </div>
  );
}
