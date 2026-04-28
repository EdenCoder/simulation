import React, { useMemo, useEffect, useState } from 'react';

interface AgentThoughtProps {
  content: string;
  timestamp: number;
  duration: number;
}

export const AgentThought = ({
  content,
  timestamp,
  duration
}: AgentThoughtProps) => {
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
      <div className="relative game-card game-card--thought line-clamp-4">
        <span className="font-semibold not-italic">Thinking...</span> {content}
        <div className="game-card__tail">
          <div className="game-card__tail-arrow" />
        </div>
      </div>
    </div>
  );
};

export default AgentThought;