'use client';

import React, { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { StepperHeader } from '@/components/StepperHeader';
import { Step1Detect } from '@/components/Step1Detect';
import { Step2Identify } from '@/components/Step2Identify';
import { Step3Capture } from '@/components/Step3Capture';
import { Step4Submit } from '@/components/Step4Submit';

export default function Home() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [sessionData, setSessionData] = useState<any>(null);
  const [deviceData, setDeviceData] = useState<any>(null);
  const [evidenceData, setEvidenceData] = useState<any>(null);

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem('smartassur-draft') || '{}');
      if (draft.savedAt && Date.now() - draft.savedAt < 24 * 60 * 60 * 1000) {
        setCurrentStep(Math.min(Math.max(draft.currentStep || 1, 1), 4));
        setSessionData(draft.sessionData || null);
        setDeviceData(draft.deviceData || null);
      }
    } catch {
      localStorage.removeItem('smartassur-draft');
    }
  }, []);

  useEffect(() => {
    if (currentStep > 1) {
      localStorage.setItem('smartassur-draft', JSON.stringify({ currentStep, sessionData, deviceData, savedAt: Date.now() }));
    }
  }, [currentStep, sessionData, deviceData]);

  const handleStep1Complete = (data: any) => {
    // Nouvelle détection = potentiellement un autre téléphone : ne pas réutiliser l'IMEI du brouillon précédent.
    if (data?.sessionToken !== sessionData?.sessionToken) {
      setDeviceData(null);
      setEvidenceData(null);
    }
    setSessionData(data);
    setCurrentStep(2);
  };

  const handleStep2Complete = (data: any) => {
    setDeviceData(data);
    setCurrentStep(3);
  };

  const handleStep3Complete = (data: any) => {
    setEvidenceData(data);
    setCurrentStep(4);
  };

  const handleSubmitted = () => localStorage.removeItem('smartassur-draft');

  return (
    <>
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
        {/* Step Indicator Header */}
        <StepperHeader
          currentStep={currentStep}
          onStepClick={(step) => {
            if (step < currentStep) setCurrentStep(step);
          }}
        />

        {/* Dynamic Wizard Steps */}
        <div className="w-full">
          {currentStep === 1 && (
            <Step1Detect onComplete={handleStep1Complete} />
          )}

          {currentStep === 2 && (
            <Step2Identify
              initialData={deviceData}
              detectedDevice={sessionData?.deviceInfo}
              sessionToken={sessionData?.sessionToken}
              challengeCode={sessionData?.challengeCode}
              onBack={() => setCurrentStep(1)}
              onComplete={handleStep2Complete}
            />
          )}

          {currentStep === 3 && (
            <Step3Capture
              sessionToken={sessionData?.sessionToken}
              deviceData={deviceData}
              onBack={() => setCurrentStep(2)}
              onComplete={handleStep3Complete}
            />
          )}

          {currentStep === 4 && (
            <Step4Submit
              deviceData={deviceData}
              evidenceData={evidenceData}
              sessionData={sessionData}
              onBack={() => setCurrentStep(3)}
              onSubmitted={handleSubmitted}
            />
          )}
        </div>

        <div className="mt-12 text-center text-xs text-slate-500">
          <p className="text-[11px] text-slate-400">
            SmartAssur Mobile • Aucune installation requise • Validation sous réserve d'audit des pièces
          </p>
        </div>
      </main>
    </>
  );
}

