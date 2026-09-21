import Header from '@/components/Header';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="nabin-container" style={{ paddingBlock: 'var(--space-xl)' }}>
        {children}
      </main>
    </>
  );
}
