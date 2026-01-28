import React from 'react';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { StatusBar } from '@/components/StatusBar';
import { LayoutDashboard, Settings, Network, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';

export const MainLayout: React.FC = () => {
  const location = useLocation();
  const { t } = useTranslation();

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.accounts') },
    { to: '/proxy', icon: Network, label: t('nav.proxy', 'API Proxy') },
    { to: '/local', icon: Rocket, label: t('nav.local', 'IA Local') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ];

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden font-sans antialiased">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Refined Minimalism 2025 */}
        <aside className="w-64 flex flex-col border-r border-border bg-card/30 backdrop-blur-sm">
          <div className="p-8">
            <div className="flex items-center gap-3">
              <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg shadow-sm">
                <Rocket className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-xl font-serif font-bold tracking-tight leading-none">
                  Antigravity
                </h1>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mt-1">
                  Management Suite
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-4 mt-4">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-secondary text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                  )}
                >
                  <item.icon className={cn("h-4 w-4 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-6 border-t border-border/50">
            <StatusBar />
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-auto bg-background/50 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};
