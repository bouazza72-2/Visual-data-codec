import React, { useState, useMemo } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
  Download,
  ShieldCheck,
  Search,
  Filter,
  Sliders,
  FileCode,
  Sparkles,
  Hash,
  Layers,
  ChevronDown,
} from 'lucide-react';
import {
  KeyValueEntry,
  KeyValueParseResult,
  maskValue,
  exportToConfFile,
  exportToKeysFile,
  generateSyntheticKeySample,
} from '../utils/keyValueParser';

interface KeyValueInspectorProps {
  parseResult: KeyValueParseResult;
  onLoadSynthetic?: (sampleText: string) => void;
  title?: string;
  sourceContext?: 'decoder' | 'livestream' | 'standalone';
}

export const KeyValueInspector: React.FC<KeyValueInspectorProps> = ({
  parseResult,
  onLoadSynthetic,
  title = 'Extracted Configuration & Keys',
  sourceContext = 'decoder',
}) => {
  const [globalUnmasked, setGlobalUnmasked] = useState<boolean>(false);
  const [rowUnmasked, setRowUnmasked] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Toggle individual row privacy mask
  const toggleRowMask = (id: string) => {
    setRowUnmasked((prev) => ({
      ...prev,
      [id]: prev[id] !== undefined ? !prev[id] : !globalUnmasked,
    }));
  };

  const isEntryUnmasked = (entry: KeyValueEntry) => {
    if (rowUnmasked[entry.id] !== undefined) {
      return rowUnmasked[entry.id];
    }
    return globalUnmasked;
  };

  const handleCopySingle = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCopyAll = () => {
    const text = exportToConfFile(parseResult.entries, title);
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleDownloadKeys = () => {
    const content = exportToKeysFile(parseResult.entries, title);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_testbed.keys';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadConf = () => {
    const content = exportToConfFile(parseResult.entries, title);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_config.conf';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter entries based on search and category
  const filteredEntries = useMemo(() => {
    return parseResult.entries.filter((entry) => {
      const matchesSearch =
        searchQuery.trim() === '' ||
        entry.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (entry.section && entry.section.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (categoryFilter === '128') return entry.bitLength === 128;
      if (categoryFilter === '256') return entry.bitLength === 256;
      if (categoryFilter === 'hex') return entry.isHex;
      if (categoryFilter === 'text') return !entry.isHex;

      return true;
    });
  }, [parseResult.entries, searchQuery, categoryFilter]);

  if (!parseResult.hasEntries) {
    return null;
  }

  return (
    <div
      id="keys-inspector-card"
      className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden transition-all animate-in fade-in duration-200"
    >
      {/* Header Bar */}
      <div className="p-4 sm:p-5 border-b border-stone-200 bg-stone-50/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
            <Key className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-stone-900">{title}</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold border border-amber-200">
                {parseResult.totalKeys} {parseResult.totalKeys === 1 ? 'Entry' : 'Entries'}
              </span>
              {parseResult.hex128Count > 0 && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {parseResult.hex128Count} × 128b
                </span>
              )}
              {parseResult.hex256Count > 0 && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {parseResult.hex256Count} × 256b
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              Parsed from decoded optical payload using offline regex structure validation. All values verified locally.
            </p>
          </div>
        </div>

        {/* Global Mask & Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Global Privacy Mask Toggle */}
          <button
            id="btn-toggle-mask-all"
            onClick={() => setGlobalUnmasked(!globalUnmasked)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all shadow-2xs ${
              globalUnmasked
                ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                : 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200'
            }`}
            title={globalUnmasked ? 'Mask all sensitive hex values' : 'Show full unmasked hex values'}
          >
            {globalUnmasked ? (
              <>
                <EyeOff className="w-3.5 h-3.5 text-amber-700" />
                <span>Mask All</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5 text-stone-600" />
                <span>Unmask All</span>
              </>
            )}
          </button>

          {/* Copy All */}
          <button
            id="btn-copy-all-keys"
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 transition-all shadow-2xs"
            title="Copy all extracted entries as configuration"
          >
            {copiedAll ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-stone-600" />
                <span>Copy All</span>
              </>
            )}
          </button>

          {/* Export .keys */}
          <button
            id="btn-export-keys-file"
            onClick={handleDownloadKeys}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white shadow-2xs transition-all"
            title="Export standard .keys format for educational testbeds"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>Export .keys</span>
          </button>

          {/* Export .conf */}
          <button
            id="btn-export-conf-file"
            onClick={handleDownloadConf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 transition-all shadow-2xs"
            title="Export standard .conf format"
          >
            <FileCode className="w-3.5 h-3.5 text-blue-600" />
            <span>Export .conf</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-3 px-4 bg-stone-50/30 border-b border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="input-filter-keys"
            type="text"
            placeholder="Search key identifier or value..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono placeholder:font-sans"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          <span className="text-[11px] text-stone-400 font-medium mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Filter:
          </span>
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              categoryFilter === 'all'
                ? 'bg-stone-800 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
            }`}
          >
            All ({parseResult.entries.length})
          </button>
          <button
            onClick={() => setCategoryFilter('128')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              categoryFilter === '128'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
            }`}
          >
            128-bit ({parseResult.hex128Count})
          </button>
          <button
            onClick={() => setCategoryFilter('256')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              categoryFilter === '256'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
            }`}
          >
            256-bit ({parseResult.hex256Count})
          </button>
          <button
            onClick={() => setCategoryFilter('text')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              categoryFilter === 'text'
                ? 'bg-stone-700 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
            }`}
          >
            Config Strings ({parseResult.entries.length - parseResult.hexCount})
          </button>
        </div>
      </div>

      {/* Entries Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-stone-100/70 border-b border-stone-200 text-stone-500 font-semibold text-[11px] uppercase tracking-wider">
              <th className="py-2.5 px-4 w-12 text-center">#</th>
              <th className="py-2.5 px-4">Key Identifier</th>
              <th className="py-2.5 px-4 w-36">Classification</th>
              <th className="py-2.5 px-4 min-w-[280px]">Value</th>
              <th className="py-2.5 px-4 w-40">Value SHA-256</th>
              <th className="py-2.5 px-4 w-20 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 font-mono">
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-stone-400 font-sans">
                  No keys matching the filter criteria.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, idx) => {
                const unmasked = isEntryUnmasked(entry);
                const displayVal = unmasked || !entry.isHex ? entry.value : maskValue(entry.value);

                return (
                  <tr
                    key={entry.id}
                    className="hover:bg-amber-50/30 transition-colors group"
                  >
                    {/* Line Index */}
                    <td className="py-2.5 px-4 text-center text-stone-400 text-[11px]">
                      {entry.lineNumber}
                    </td>

                    {/* Key Name & Section */}
                    <td className="py-2.5 px-4 font-bold text-stone-900">
                      <div className="flex items-center gap-1.5">
                        <span>{entry.key}</span>
                        {entry.section && (
                          <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 border border-stone-200">
                            [{entry.section}]
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Classification */}
                    <td className="py-2.5 px-4">
                      {entry.bitLength === 128 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          128-bit (AES-128 / IV)
                        </span>
                      ) : entry.bitLength === 256 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          256-bit (AES-256 / SHA)
                        </span>
                      ) : entry.bitLength === 512 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                          512-bit (SHA-512)
                        </span>
                      ) : entry.isHex ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                          {entry.bitLength}b Hex
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-stone-50 text-stone-600 border border-stone-200">
                          Config String
                        </span>
                      )}
                    </td>

                    {/* Value with Eye Toggle */}
                    <td className="py-2.5 px-4 font-mono text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate select-all ${
                            entry.isHex ? (unmasked ? 'text-amber-900 font-semibold' : 'text-stone-700') : 'text-stone-800'
                          }`}
                          title={entry.value}
                        >
                          {displayVal}
                        </span>

                        {entry.isHex && (
                          <button
                            onClick={() => toggleRowMask(entry.id)}
                            className="p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200 transition-colors shrink-0"
                            title={unmasked ? 'Mask this key' : 'Reveal full key hex'}
                          >
                            {unmasked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* SHA-256 Hash Digest */}
                    <td className="py-2.5 px-4 font-mono text-[11px] text-stone-500">
                      <div className="flex items-center gap-1" title={`SHA-256: ${entry.sha256Hex}`}>
                        <Hash className="w-3 h-3 text-stone-400 shrink-0" />
                        <span className="truncate">{entry.sha256Hex.slice(0, 12)}...</span>
                        {entry.isHashValid !== undefined && (
                          <span
                            className={`px-1 rounded text-[9px] font-bold ${
                              entry.isHashValid
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {entry.isHashValid ? 'MATCH' : 'FAIL'}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Copy Single Action */}
                    <td className="py-2.5 px-4 text-center">
                      <button
                        onClick={() => handleCopySingle(entry.id, entry.value)}
                        className="p-1.5 text-stone-400 hover:text-stone-800 hover:bg-stone-200/70 rounded-lg transition-all"
                        title="Copy key value"
                      >
                        {copiedId === entry.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info & Academic Testing Note */}
      <div className="p-3 px-4 bg-stone-50 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-stone-500 font-sans">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>
            Offline Parsing: 100% Client-Side. Compatible with <code className="font-mono font-semibold">key_parser.py</code> and <code className="font-mono font-semibold">live_stream_decoder.py</code>.
          </span>
        </div>

        {onLoadSynthetic && (
          <button
            onClick={() => onLoadSynthetic(generateSyntheticKeySample())}
            className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 font-semibold underline underline-offset-2"
          >
            <Sparkles className="w-3 h-3" />
            <span>Load Synthetic Academic Testbed</span>
          </button>
        )}
      </div>
    </div>
  );
};
