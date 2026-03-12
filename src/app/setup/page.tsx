import { SetupWizard } from '@/components/setup-wizard';

export default function SetupPage() {
  return (
    <main className="flex h-screen min-h-[100dvh] w-full flex-col items-center justify-start overflow-y-auto bg-background p-4 pb-10 pt-6 sm:p-8 md:justify-center md:py-12">
      <div className="w-full max-w-4xl">
        <SetupWizard />
      </div>
    </main>
  );
}
