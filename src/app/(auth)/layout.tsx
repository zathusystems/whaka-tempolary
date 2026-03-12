import { HandyPosLogo } from '@/components/icons/logo';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-8 flex items-center gap-3 text-center">
        <HandyPosLogo className="h-10 w-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Mwaka POS</h1>
      </div>
      {children}
    </main>
  );
}
