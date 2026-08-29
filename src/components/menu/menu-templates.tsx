'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Download, FileText, Grid3x3, List, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { InventoryItem } from '@/lib/db';

interface MenuTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  format: 'pdf' | 'html';
  layout: 'grid' | 'list' | 'table';
  features: string[];
  generateContent: (items: InventoryItem[]) => string;
}

const generatePDFContent = (items: InventoryItem[], layout: string): string => {
  const itemsHTML = items
    .map(
      (item) => `
    <div style="margin-bottom: 20px; page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h3 style="margin: 0 0 5px 0; font-size: 16px; font-weight: bold;">${item.name}</h3>
          <p style="margin: 0; font-size: 12px; color: #666;">${item.category || ''}</p>
        </div>
        <div style="text-align: right;">
          <p style="margin: 0; font-size: 14px; font-weight: bold;">$${Number(item.price)?.toFixed(2) || '0.00'}</p>
        </div>
      </div>
    </div>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Menu</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 40px;
          color: #333;
        }
        h1 {
          text-align: center;
          margin-bottom: 30px;
          font-size: 28px;
        }
        .menu-container {
          max-width: 800px;
          margin: 0 auto;
        }
        @media print {
          body { margin: 20px; }
          h1 { margin-bottom: 20px; }
        }
      </style>
    </head>
    <body>
      <h1>Menu</h1>
      <div class="menu-container">
        ${itemsHTML}
      </div>
    </body>
    </html>
  `;
};

const generateGridPDFContent = (items: InventoryItem[]): string => {
  const itemsHTML = items
    .map(
      (item) => `
    <div style="border: 1px solid #ddd; padding: 15px; text-align: center; page-break-inside: avoid;">
      ${
        item.image
          ? `<img src="${item.image}" style="width: 100%; height: 150px; object-fit: cover; margin-bottom: 10px; border-radius: 4px;" />`
          : `<div style="width: 100%; height: 150px; background: #f0f0f0; margin-bottom: 10px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999;">No Image</div>`
      }
      <h3 style="margin: 10px 0 5px 0; font-size: 14px; font-weight: bold;">${item.name}</h3>
      <p style="margin: 0 0 10px 0; font-size: 11px; color: #666;">${item.category || ''}</p>
      <p style="margin: 0; font-size: 16px; font-weight: bold; color: #2c3e50;">$${Number(item.price)?.toFixed(2) || '0.00'}</p>
    </div>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Menu</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          color: #333;
        }
        h1 {
          text-align: center;
          margin-bottom: 30px;
          font-size: 28px;
        }
        .menu-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          max-width: 1000px;
          margin: 0 auto;
        }
        @media print {
          body { margin: 10px; }
          .menu-grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
        }
      </style>
    </head>
    <body>
      <h1>Menu</h1>
      <div class="menu-grid">
        ${itemsHTML}
      </div>
    </body>
    </html>
  `;
};

const generateTablePDFContent = (items: InventoryItem[]): string => {
  const itemsHTML = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #ddd;">${item.name}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ddd;">${item.category || '-'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ddd; text-align: right; font-weight: bold;">$${Number(item.price)?.toFixed(2) || '0.00'}</td>
    </tr>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Menu</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          color: #333;
        }
        h1 {
          text-align: center;
          margin-bottom: 30px;
          font-size: 28px;
        }
        table {
          width: 100%;
          max-width: 900px;
          margin: 0 auto;
          border-collapse: collapse;
        }
        th {
          background: #f5f5f5;
          padding: 12px;
          text-align: left;
          font-weight: bold;
          border-bottom: 2px solid #333;
        }
        @media print {
          body { margin: 10px; }
        }
      </style>
    </head>
    <body>
      <h1>Menu</h1>
      <table>
        <thead>
          <tr>
            <th>Item Name</th>
            <th>Category</th>
            <th style="text-align: right;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHTML}
        </tbody>
      </table>
    </body>
    </html>
  `;
};

const templates: MenuTemplate[] = [
  {
    id: 'simple-list',
    name: 'Simple List',
    description: 'Clean, minimalist list format perfect for quick printing',
    icon: <List className="h-6 w-6" />,
    format: 'pdf',
    layout: 'list',
    features: ['Item names', 'Categories', 'Prices', 'Print-ready'],
    generateContent: (items) => generatePDFContent(items, 'list'),
  },
  {
    id: 'grid-with-images',
    name: 'Grid with Images',
    description: 'Visual grid layout showcasing item images',
    icon: <Grid3x3 className="h-6 w-6" />,
    format: 'pdf',
    layout: 'grid',
    features: ['Item images', 'Grid layout', '3 columns', 'Professional'],
    generateContent: (items) => generateGridPDFContent(items),
  },
  {
    id: 'table-format',
    name: 'Table Format',
    description: 'Organized table layout with all details',
    icon: <FileText className="h-6 w-6" />,
    format: 'pdf',
    layout: 'table',
    features: ['Organized table', 'All details', 'Easy to read', 'Professional'],
    generateContent: (items) => generateTablePDFContent(items),
  },
];

export function MenuTemplates({ menuItems }: { menuItems: InventoryItem[] }) {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<MenuTemplate | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleDownload = (template: MenuTemplate) => {
    if (menuItems.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No items to download',
        description: 'Add items to your menu before downloading a template.',
      });
      return;
    }

    const content = template.generateContent(menuItems);
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `menu-${template.id}-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Menu downloaded!',
      description: `${template.name} template has been downloaded. Open it in your browser and print to PDF.`,
    });
  };

  const handlePreview = (template: MenuTemplate) => {
    setSelectedTemplate(template);
    setIsPreviewOpen(true);
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    {template.icon}
                  </div>
                  <div>
                    <CardTitle className="text-base">{template.name}</CardTitle>
                  </div>
                </div>
              </div>
              <CardDescription>{template.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap gap-1">
                {template.features.map((feature) => (
                  <Badge key={feature} variant="secondary" className="text-xs">
                    {feature}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePreview(template)}
                  disabled={menuItems.length === 0}
                >
                  Preview
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleDownload(template)}
                  disabled={menuItems.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Preview: {selectedTemplate?.name}</DialogTitle>
            <DialogDescription>
              This is how your menu will look when printed
            </DialogDescription>
          </DialogHeader>
          {selectedTemplate && (
            <div className="overflow-y-auto border rounded-lg bg-white p-4">
              <iframe
                srcDoc={selectedTemplate.generateContent(menuItems)}
                className="w-full h-[600px] border-0"
                title="Menu Preview"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
