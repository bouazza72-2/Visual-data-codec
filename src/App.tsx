import React, { useState } from 'react';
import { Header, ActiveTab } from './components/Header';
import { EncoderView } from './components/EncoderView';
import { DecoderView } from './components/DecoderView';
import { UpscalerView } from './components/UpscalerView';
import { PythonScriptView } from './components/PythonScriptView';
import { HeaderSpecView } from './components/HeaderSpecView';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('encoder');

  return (
    <div className="min-h-screen bg-stone-100/70 text-stone-900 flex flex-col font-sans antialiased selection:bg-stone-800 selection:text-white">
      {/* Top Navigation */}
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <main className="flex-1">
        {activeTab === 'encoder' && <EncoderView />}
        {activeTab === 'decoder' && <DecoderView />}
        {activeTab === 'upscaler' && <UpscalerView />}
        {activeTab === 'python' && <PythonScriptView />}
        {activeTab === 'spec' && <HeaderSpecView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white/70 py-6 text-center text-xs text-stone-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-stone-700">Visual Data Codec</span>
            <span>•</span>
            <span>Lossless PNG Binary & Text Encoding with Row-0 CRC32 Header</span>
          </div>
          <div className="flex items-center gap-4 text-stone-400">
            <span>NumPy</span>
            <span>•</span>
            <span>PIL (Pillow)</span>
            <span>•</span>
            <span>OpenCV</span>
            <span>•</span>
            <span>IEEE 802.3 CRC32</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
