import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — NEXUS Terminal" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-nx-bg p-4">
      <div className="w-full max-w-sm border border-nx-border-strong bg-nx-panel">
        <div className="border-b border-nx-border-strong px-4 py-3">
          <div className="text-[13px] font-bold tracking-widest text-nx-amber">NEXUS TERMINAL</div>
          <div className="mt-0.5 text-[10px] text-nx-muted">Professional financial research platform</div>
        </div>
        <LoginForm />
        <div className="border-t border-nx-border px-4 py-2 text-[9px] leading-relaxed text-nx-faint">
          Demo environment — market data is generated sample data. Research software only; no brokerage connection, no real trading.
        </div>
      </div>
    </div>
  );
}
