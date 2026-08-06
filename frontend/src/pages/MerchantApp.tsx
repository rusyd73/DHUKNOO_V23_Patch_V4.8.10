// src/pages/MerchantApp.tsx
import React, { useState } from 'react';
import  MerchantDashboard  from './Dashboard';
import { MerchantProducts } from './Products';
import { MerchantOrders } from './Orders';
import { MerchantSettings } from './Settings';
import { MerchantSidebar } from '../components/merchant/Sidebar';

interface MerchantAppProps {
  onBack: () => void;
  triggerToast: (msg: string) => void;
}

type Tab = 'dashboard' | 'products' | 'orders' | 'settings';

export default function MerchantApp({ onBack, triggerToast }: MerchantAppProps) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <MerchantDashboard />;
      case 'products':
        return <MerchantProducts />;
      case 'orders':
        return <MerchantOrders />;
      case 'settings':
        return <MerchantSettings />;
      default:
        return <MerchantDashboard />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#06170E]">
      {/* ✅ Perbaiki: setActiveTab menerima string, cocok dengan Sidebar */}
      <MerchantSidebar 
        onBack={onBack} 
        setActiveTab={(tab: string) => setActiveTab(tab as Tab)} 
        activeTab={activeTab} 
      />
      <div className="flex-1 p-6 overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  );
}