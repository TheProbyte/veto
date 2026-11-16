import type { ReactNode } from 'react';
import type { RoomProps } from '../props';
export default function Saloon({ children }: RoomProps & { children: ReactNode }) { return <div className="saloon">{children}</div>; }
