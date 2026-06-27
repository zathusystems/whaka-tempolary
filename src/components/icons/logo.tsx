import type { ImgHTMLAttributes } from 'react';

export function HandyPosLogo({ alt = 'HandyPOS Logo', className = '', ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src="/app-icon.png"
      alt={alt}
      className={`object-contain ${className}`.trim()}
      draggable={false}
      {...props}
    />
  );
}
