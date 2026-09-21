import React from 'react';
import { Binary, FileCode, HardDriveDownload, Sparkles, Layers, Maximize2 } from 'lucide-react';

export type ActiveTab = 'encoder' | 'decoder' | 'upscaler' | 'python' | 'spec';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="border-b border-stone-200 bg-white/90 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-stone-900 flex items-center justify-center text-white shadow-sm">
              <Binary className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-stone-900 tracking-tight">
                  Visual Data Codec
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-stone-100 text-stone-600 border border-stone-200">
                  v1.0 • Lossless PNG
                </span>
              </div>
              <p className="text-xs text-stone-500 hidden sm:block">
                Binary & Text Visual Pixel Grid Encoder/Decoder with Row-0 CRC32 Header
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 p-1 bg-stone-100 rounded-xl border border-stone-200 text-sm font-medium">
            <button
              id="tab-encoder"
              onClick={() => setActiveTab('encoder')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === 'encoder'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
              }`}
            >
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>Encoder</span>
            </button>

            <button
              id="tab-decoder"
              onClick={() => setActiveTab('decoder')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === 'decoder'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
              }`}
            >
              <HardDriveDownload className="w-4 h-4 text-indigo-600" />
              <span>Decoder</span>
            </button>

            <button
              id="tab-upscaler"
              onClick={() => setActiveTab('upscaler')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === 'upscaler'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
              }`}
            >
              <Maximize2 className="w-4 h-4 text-purple-600" />
              <span className="hidden sm:inline">10× Upscaler</span>
              <span className="sm:hidden">10×</span>
            </button>

            <button
              id="tab-python"
              onClick={() => setActiveTab('python')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === 'python'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
              }`}
            >
              <FileCode className="w-4 h-4 text-amber-600" />
              <span className="hidden md:inline">Python Script</span>
              <span className="md:hidden">Python</span>
            </button>

            <button
              id="tab-spec"
              onClick={() => setActiveTab('spec')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === 'spec'
                  ? 'bg-white text-stone-900 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
              }`}
            >
              <Layers className="w-4 h-4 text-stone-500" />
              <span className="hidden md:inline">Header Spec</span>
              <span className="md:hidden">Spec</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
