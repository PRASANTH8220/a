import React from 'react';
import { Eye, BarChart2, Briefcase, ClipboardList, LineChart } from 'lucide-react';
import { useOrderStore } from '../../store/useOrderStore';
import MarketWatch from '../MarketWatch/MarketWatch';
import Scanner from '../Scanner/Scanner';
import Positions from '../Positions/Positions';
import OrderBook from '../Orders/OrderBook';
import Analytics from '../Analytics/Analytics';

const TABS = [
  { key: 'watchlist', label: 'Watch', Icon: Eye },
  { key: 'scanner', label: 'Scan', Icon: BarChart2 },
  { key: 'positions', label: 'Positions', Icon: Briefcase },
  { key: 'orders', label: 'Orders', Icon: ClipboardList },
  { key: 'analytics', label: 'Analytics', Icon: LineChart },
];

export default function Sidebar() {
  const { activeTab, setActiveTab } = useOrderStore();

  return (
    <div className="w-60 flex-shrink-0 flex flex-col bg-surface border-r border-border overflow-hidden">
      {/* Tab Bar */}
      <div className="flex border-b border-border flex-shrink-0">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors
              ${activeTab === key
                ? 'text-accent border-b-2 border-accent bg-accent/5'
                : 'text-text-secondary hover:text-text-primary hover:bg-card'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="leading-none">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'watchlist' && <MarketWatch />}
        {activeTab === 'scanner' && <Scanner />}
        {activeTab === 'positions' && <Positions />}
        {activeTab === 'orders' && <OrderBook />}
        {activeTab === 'analytics' && <Analytics />}
      </div>
    </div>
  );
}
