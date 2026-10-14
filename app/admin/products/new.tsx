import React from 'react';
import { AdminShell } from '../../../components/admin/AdminShell';
import { ProductWizard } from '../../../components/admin/ProductWizard';

export default function AdminNewProductScreen() {
  return (
    <AdminShell title="Add Product" subtitle="Guided setup for a new catalogue item">
      <ProductWizard mode="create" />
    </AdminShell>
  );
}
