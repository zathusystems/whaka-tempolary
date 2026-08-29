import type { EisStockReceiptSource, PurchaseRecord } from '@/lib/db';

export interface EditablePurchaseGroup {
    groupId: string;
    purchaseOrderId?: string;
    receivedDate: string;
    supplierId?: string;
    supplierName: string;
    paymentStatus: PurchaseRecord['paymentStatus'];
    eisStockReceiptSource?: EisStockReceiptSource;
    referenceNumber?: string;
    vatAmount?: number;
    items: PurchaseRecord[];
}
