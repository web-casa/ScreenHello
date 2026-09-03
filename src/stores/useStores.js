import { useContext } from 'react';
import StoreContext from './storeContext';

export default function useStores() {
    const stores = useContext(StoreContext);
    if (!stores) throw new Error('useStores must be used inside StoreProvider');
    return stores;
}
