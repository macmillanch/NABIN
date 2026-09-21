import Link from 'next/link';

interface FlowPageProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function FlowPage({ title, subtitle, children }: FlowPageProps) {
  return (
    <div className="nabin-flow">
      <Link href="/" className="nabin-back">
        &#8592; Back to services
      </Link>
      <div className="nabin-page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
