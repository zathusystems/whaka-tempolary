'use client';

import { GlassWater } from 'lucide-react';
import { GenericPos, type PosProps } from './generic-pos';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InventoryItem } from '@/lib/db';

export const BarLiquorPos = (props: PosProps) => {
    const [portionDialog, setPortionDialog] = useState(false);
    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
    const [portionQuantity, setPortionQuantity] = useState(1);

    const handleAddToCart = (item: InventoryItem) => {
        // If item is sold in portions, show portion dialog
        if (item.isSoldInPortions && item.portionsPerUnit && item.portionsPerUnit > 0) {
            setSelectedItem(item);
            setPortionQuantity(1);
            setPortionDialog(true);
        } else {
            // Otherwise, add normally
            props.onAddToCart(item);
        }
    };

    const handleConfirmPortion = () => {
        if (selectedItem && portionQuantity > 0) {
            // Calculate the quantity in full units based on portions
            // If 1 portion = 1/25 of a bottle, then 25 portions = 1 bottle
            const fullUnits = portionQuantity / (selectedItem.portionsPerUnit || 1);
            
            // Add to cart with the calculated quantity
            props.onAddToCart(selectedItem, fullUnits);
            
            setPortionDialog(false);
            setSelectedItem(null);
            setPortionQuantity(1);
        }
    };

    return (
        <>
            <GenericPos 
                {...props} 
                productIcon={<GlassWater className="h-8 w-8 text-muted-foreground" data-ai-hint="bar liquor bottle" />}
                onAddToCart={handleAddToCart}
            />
            
            {/* Portion Selection Dialog */}
            <Dialog open={portionDialog} onOpenChange={setPortionDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Select Portions</DialogTitle>
                    </DialogHeader>
                    {selectedItem && (
                        <div className="space-y-4 py-4">
                            <div>
                                <p className="font-semibold text-lg">{selectedItem.name}</p>
                                <p className="text-sm text-muted-foreground">
                                    {selectedItem.portionsPerUnit} {selectedItem.portionName}s per bottle
                                </p>
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="portions">Number of {selectedItem.portionName}s</Label>
                                <div className="flex items-center gap-2">
                                    <Button 
                                        variant="outline" 
                                        size="icon"
                                        onClick={() => setPortionQuantity(Math.max(1, portionQuantity - 1))}
                                    >
                                        −
                                    </Button>
                                    <Input 
                                        id="portions"
                                        type="number" 
                                        min="1" 
                                        value={portionQuantity}
                                        onChange={(e) => setPortionQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="text-center text-lg font-semibold"
                                    />
                                    <Button 
                                        variant="outline" 
                                        size="icon"
                                        onClick={() => setPortionQuantity(portionQuantity + 1)}
                                    >
                                        +
                                    </Button>
                                </div>
                            </div>

                            <div className="bg-muted/50 p-3 rounded-lg space-y-1">
                                <div className="flex justify-between text-sm">
                                    <span>Portions:</span>
                                    <span className="font-semibold">{portionQuantity} {selectedItem.portionName}s</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>Full Units:</span>
                                    <span className="font-semibold">
                                        {(portionQuantity / (selectedItem.portionsPerUnit || 1)).toFixed(2)} bottles
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm font-semibold">
                                    <span>Price:</span>
                                    <span>${((portionQuantity / (selectedItem.portionsPerUnit || 1)) * (selectedItem.price || 0)).toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPortionDialog(false)}>Cancel</Button>
                        <Button onClick={handleConfirmPortion}>Add to Cart</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
