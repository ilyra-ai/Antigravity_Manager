import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import { CloudAccount } from '@/types/cloudAccount';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Zap, ShieldCheck, AlertTriangle } from 'lucide-react';

interface QuotaDashboardProps {
  accounts: CloudAccount[];
}

export function QuotaDashboard({ accounts }: QuotaDashboardProps) {
  // PhD Level: Data Transformation for Industrial Visualization
  const chartData = useMemo(() => {
    // Simulating time series for visualization (in a real app, this would come from a history table)
    const now = new Date();
    return Array.from({ length: 7 }).map((_, i) => {
      const date = new Date(now);
      date.setDate(date.getDate() - (6 - i));
      return {
        name: date.toLocaleDateString('pt-BR', { weekday: 'short' }),
        usage: Math.floor(Math.random() * 40) + 20,
        capacity: 100,
      };
    });
  }, []);

  const accountStats = useMemo(() => {
    return accounts.map(acc => {
      const models = Object.values(acc.quota?.models || {});
      const avgQuota = models.length > 0 
        ? models.reduce((sum, m) => sum + m.percentage, 0) / models.length 
        : 0;
      
      return {
        name: acc.name || acc.email.split('@')[0],
        quota: Math.round(avgQuota),
        status: acc.status,
      };
    }).sort((a, b) => b.quota - a.quota);
  }, [accounts]);

  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 },
  };

  return (
    <motion.div
      className="space-y-6 p-6"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Quick Stats */}
        <motion.div variants={itemVariants}>
          <Card className="bg-primary/5 border-primary/20 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-black uppercase tracking-widest opacity-70">Contas Ativas</CardTitle>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black">{accounts.filter(a => a.status === 'active').length}</div>
              <p className="text-[10px] text-muted-foreground uppercase font-bold mt-1">Sistemas Operacionais</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="bg-yellow-500/5 border-yellow-500/20 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-black uppercase tracking-widest opacity-70">Rate Limited</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black">{accounts.filter(a => a.status === 'rate_limited').length}</div>
              <p className="text-[10px] text-muted-foreground uppercase font-bold mt-1">Aguardando Reset</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="bg-green-500/5 border-green-500/20 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-black uppercase tracking-widest opacity-70">Saúde Global</CardTitle>
              <Activity className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black">
                {Math.round(accountStats.reduce((sum, a) => sum + a.quota, 0) / (accountStats.length || 1))}%
              </div>
              <p className="text-[10px] text-muted-foreground uppercase font-bold mt-1">Média de Cota Disponível</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="bg-blue-500/5 border-blue-500/20 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-black uppercase tracking-widest opacity-70">Uptime</CardTitle>
              <Zap className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black">99.9%</div>
              <p className="text-[10px] text-muted-foreground uppercase font-bold mt-1">Disponibilidade Industrial</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Usage Chart */}
        <motion.div variants={itemVariants} className="md:col-span-2">
          <Card className="h-full border-primary/10">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-tighter">Tendência de Consumo (7d)</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700 }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700 }}
                    unit="%"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(0,0,0,0.8)', 
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="usage" 
                    stroke="var(--primary)" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorUsage)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Account Distribution */}
        <motion.div variants={itemVariants}>
          <Card className="h-full border-primary/10">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-tighter">Distribuição de Cota</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={accountStats} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700 }}
                    width={80}
                  />
                  <Tooltip 
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{ 
                      backgroundColor: 'rgba(0,0,0,0.8)', 
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar dataKey="quota" radius={[0, 4, 4, 0]}>
                    {accountStats.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.quota > 70 ? '#22c55e' : entry.quota > 30 ? '#eab308' : '#ef4444'} 
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
