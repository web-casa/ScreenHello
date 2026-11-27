import { createContext, useContext } from 'react';

export const RecoveryContext = createContext(false);
export const useSafeRecovery = () => useContext(RecoveryContext);
