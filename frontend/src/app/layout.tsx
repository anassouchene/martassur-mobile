import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartAssur Mobile | Assurance smartphone 100% web en 4 étapes',
  description: 'Souscription instantanée, vérification anti-fraude en 4 étapes, aucun téléchargement d’application requis.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="antialiased bg-slate-50 text-slate-900 min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}

