import jharkhandEmblem from '../assets/jharkhand-emblem.png';
import ptrLogo from '../assets/ptr-logo.png';

interface Props {
  compact?: boolean;
}

export default function GovHeader({ compact = false }: Props) {
  return (
    <div className="bg-white border-b border-ptr-cream-dark">
      {/* Official strip */}
      <div className="bg-ptr-green">
        <div className="relative max-w-6xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-center text-white">
          <span className="flex items-center gap-2.5 text-base font-bold tracking-wide">
            <img src={jharkhandEmblem} alt="" className="w-8 h-8 flex-shrink-0" />
            Government of Jharkhand
          </span>
          <span className="hidden sm:inline absolute right-4 md:right-6 text-xs text-white/75">
            Department of Forest, Environment &amp; Climate Change
          </span>
        </div>
      </div>

      {/* Emblem + title */}
      <div className={`max-w-6xl mx-auto px-4 md:px-6 flex items-center gap-4 ${compact ? 'py-2.5' : 'py-4'}`}>
        <div
          className={`rounded-full border-2 border-ptr-green/15 bg-ptr-cream flex items-center justify-center flex-shrink-0 overflow-hidden ${
            compact ? 'w-10 h-10' : 'w-14 h-14'
          }`}
        >
          <img src={ptrLogo} alt="Palamau Tiger Reserve emblem" className="w-full h-full object-contain p-0.5" />
        </div>
        <div className="min-w-0">
          <h1 className={`font-bold text-ptr-brown tracking-tight leading-tight ${compact ? 'text-sm' : 'text-lg md:text-xl'}`}>
            Palamau Tiger Reserve
          </h1>
          <p className={`text-ptr-brown-light font-medium ${compact ? 'text-xs' : 'text-xs md:text-sm'}`}>
            Smart Forester
          </p>
        </div>
      </div>
    </div>
  );
}
