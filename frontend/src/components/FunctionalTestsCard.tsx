'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, MinusCircle, Stethoscope } from 'lucide-react';
import { FunctionalTestReport, TestStatus } from '@/lib/functionalTests';

const ICON: Record<TestStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />,
  fail: <XCircle className="h-4 w-4 shrink-0 text-red-600" />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />,
  unsupported: <MinusCircle className="h-4 w-4 shrink-0 text-slate-400" />,
  skipped: <MinusCircle className="h-4 w-4 shrink-0 text-slate-400" />,
};
const STATUS_TEXT: Record<TestStatus, string> = { pass: 'Fonctionne', fail: 'Défaillant', warn: 'À vérifier', unsupported: 'Non vérifiable', skipped: 'Non testé' };

/** Résultats des tests de fonctionnement (téléphone, PC à l'étape 2, espace gestionnaire). */
export const FunctionalTestsCard: React.FC<{ report: FunctionalTestReport }> = ({ report }) => {
  const tested = report.tests.filter((test) => test.status !== 'unsupported' && test.status !== 'skipped');
  const working = tested.filter((test) => test.status === 'pass').length;
  const failed = report.tests.filter((test) => test.status === 'fail').length;
  return (
    <div className={`mb-5 rounded-2xl border p-4 text-xs ${failed ? 'border-red-200 bg-red-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Stethoscope className="h-4 w-4 text-blue-600" />Tests de fonctionnement</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${failed ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {working}/{tested.length} fonctionnent
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {report.tests.map((test) => (
          <li key={test.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            {ICON[test.status]}
            <span className="min-w-0">
              <span className="font-semibold text-slate-900">{test.label}</span>
              <span className="text-slate-500"> · {STATUS_TEXT[test.status]}</span>
              <span className="block text-[10px] text-slate-500">{test.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-slate-400">
        Testé sur le téléphone le {new Date(report.ranAt).toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca', dateStyle: 'short', timeStyle: 'short' })} en {Math.round(report.durationMs / 1000)} s.
      </p>
    </div>
  );
};
