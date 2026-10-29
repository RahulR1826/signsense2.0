// Re-mounted on every navigation: a short, transform/opacity-only entrance (off under reduced motion).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-1 flex-col">{children}</div>;
}
