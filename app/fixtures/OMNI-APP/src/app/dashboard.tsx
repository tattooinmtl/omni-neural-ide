import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { fetchMetrics } from '@/services/api';
import { cn } from '@/utils/cn';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchMetrics();
        setMetrics(data);
      } catch (err) {
        console.error('Failed to load metrics', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-96">Loading…</div>;
  return <main className={cn('p-6')}><Card>{metrics.length}</Card></main>;
}
