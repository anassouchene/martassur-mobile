import React from 'react';
import Link from 'next/link';
import { ShieldCheck, UserCheck } from 'lucide-react';

export const Navbar = () => {
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xl tracking-tight text-slate-900">SmartAssur</span>
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Mobile V3</span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">Assurance smartphone 100% web en 4 étapes</p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200 shadow-sm"
          >
            <UserCheck className="w-4 h-4 text-blue-600" />
            <span>Espace Gestionnaire</span>
          </Link>
        </div>
      </div>
    </header>
  );
};

