export default function MantylLoader({ message, subMessage }) {
  return (
    <div className="mantyl-loader">
      <div className="loader-backdrop" />
      <div className="loader-content">
        {/* Animated Mantyl sails */}
        <div className="loader-sails">
          <svg viewBox="0 0 80 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="sails-svg">
            <defs>
              <linearGradient id="loaderA" x1="0%" y1="100%" x2="50%" y2="0%">
                <stop offset="0%" stopColor="#5A79CA" />
                <stop offset="100%" stopColor="#8B6DB3" />
              </linearGradient>
              <linearGradient id="loaderB" x1="50%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C06E85" />
                <stop offset="100%" stopColor="#D4856A" />
              </linearGradient>
            </defs>
            <path className="sail-left" d="M8 62 L30 8 L42 50 Z" fill="url(#loaderA)" opacity="0.85" />
            <path className="sail-right" d="M38 50 L50 8 L72 62 Z" fill="url(#loaderB)" opacity="0.75" />
          </svg>

          {/* Orbiting particles */}
          <div className="orbit-ring">
            <div className="orbit-dot dot-1" />
            <div className="orbit-dot dot-2" />
            <div className="orbit-dot dot-3" />
          </div>
        </div>

        {/* Pulsing gradient bar */}
        <div className="loader-bar">
          <div className="loader-bar-fill" />
        </div>

        <div className="loader-text">{message}</div>
        {subMessage && <div className="loader-sub">{subMessage}</div>}

        {/* Animated steps */}
        <div className="loader-steps">
          <div className="loader-step active">
            <span className="step-dot" />
            Enriching prospect data
          </div>
          <div className="loader-step">
            <span className="step-dot" />
            Writing personalized copy
          </div>
          <div className="loader-step">
            <span className="step-dot" />
            Building your sequence
          </div>
        </div>
      </div>
    </div>
  )
}
