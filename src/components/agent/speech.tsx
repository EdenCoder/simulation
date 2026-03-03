import React, { useMemo, useEffect, useState } from 'react';

interface AgentSpeechProps {
  content: string;
  timestamp: number;
  duration: number;
}

export const AgentSpeech = ({
  content,
  timestamp,
  duration
}: AgentSpeechProps) => {
  // State
  const [currentTime, setCurrentTime] = useState(Date.now());

  /**
   * Calculates remaining display time
   */
  const remainingTime = useMemo(() => {
    const elapsed = currentTime - timestamp;
    return Math.max(0, duration - elapsed);
  }, [currentTime, timestamp, duration]);

  /**
   * Calculates fade opacity based on remaining time
   */
  const opacity = useMemo(() => {
    const fadeThreshold = 500;
    if (remainingTime <= fadeThreshold) {
      return remainingTime / fadeThreshold;
    }
    return 1;
  }, [remainingTime]);

  // Update current time for fade calculations
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);
    
    return () => clearInterval(interval);
  }, []);

  // Don't render if time expired
  if (remainingTime <= 0) return null;

  return (
    <div
      className="mb-1 flex flex-col items-center"
      style={{ opacity }}
    >
      <div className="relative game-card game-card--speech">
        {content}
        <div className="game-card__tail">
          <div className="game-card__tail-arrow" />
        </div>
      </div>
    </div>
  );
};

export default AgentSpeech;