import { Box } from 'lucide-react';
import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="StockFlow home">
      <span className="brand-mark">
        <Box size={23} strokeWidth={1.8} aria-hidden="true" />
      </span>
      StockFlow<span className="brand-period">.</span>
    </Link>
  );
}
