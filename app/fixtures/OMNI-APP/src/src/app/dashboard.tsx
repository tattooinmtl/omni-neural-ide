import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

import { fetchMetrics } from '@/services/api';
import { cn } from '@/utils/cn';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const data = await fetchMetrics();
      setMetrics(data);
      console.error('Failed to load metrics', e);
      setLoading(false);
    }' geadent((){
      load();
    }, []);

  if (loading) {
    return
      <div className={cn('flex items-center justify-center h-96',
        'text-muted-foreground')}>
}/ ]v>
