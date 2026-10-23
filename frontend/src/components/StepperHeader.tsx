import React from 'react';
import { Smartphone, Cpu, Camera, Send, Check } from 'lucide-react';

interface StepperHeaderProps {
  currentStep: number; // 1 to 4
  onStepClick?: (step: number) => void;
}

export const StepperHeader: React.FC<StepperHeaderProps> = ({ currentStep, onStepClick }) => {
  const steps = [
    { num: 1, title: 'Détecter mon smartphone', short: 'Détection', icon: Smartphone },
    { num: 2, title: 'Identifier mon appareil', short: 'Identification', icon: Cpu },
    { num: 3, title: 'Vérifier et photographier', short: 'Photos', icon: Camera },
    { num: 4, title: 'Envoyer ma demande', short: 'Envoi', icon: Send },
  ];

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm mb-6">
      {/* Step progress bar */}
      <div className="relative mb-6">
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-slate-100 -translate-y-1/2 z-0" />
        <div
          className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600 -translate-y-1/2 z-0 transition-all duration-500 ease-out"
          style={{ width: `${((currentStep - 1) / 3) * 100}%` }}
        />

        <div className="relative z-10 flex justify-between items-center">
          {steps.map((step) => {
            const Icon = step.icon;
            const isCompleted = step.num < currentStep;
            const isCurrent = step.num === currentStep;

            return (
              <div
                key={step.num}
                className="flex flex-col items-center cursor-pointer select-none group"
                onClick={() => onStepClick && step.num < currentStep && onStepClick(step.num)}
              >
                <div
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center font-bold text-sm sm:text-base transition-all duration-300 ${
                    isCompleted
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25 ring-2 ring-emerald-500/20'
                      : isCurrent
                      ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 ring-4 ring-blue-500/20 scale-110'
                      : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                  }`}
                >
                  {isCompleted ? <Check className="w-5 h-5 stroke-[2.5]" /> : <Icon className="w-5 h-5" />}
                </div>

                <div className="mt-2 text-center">
                  <span
                    className={`block text-[11px] font-semibold uppercase tracking-wider ${
                      isCurrent ? 'text-blue-600' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  >
                    Étape {step.num}/4
                  </span>
                  <span
                    className={`text-xs font-medium hidden sm:block ${
                      isCurrent ? 'text-slate-900 font-bold' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </span>
                  <span
                    className={`text-xs font-medium sm:hidden ${
                      isCurrent ? 'text-slate-900 font-bold' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {step.short}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

