import React, { useState } from 'react';
import { AdminShell } from '../../../components/admin/AdminShell';
import { ProductWizard } from '../../../components/admin/ProductWizard';

export default function AdminNewProductScreen() {
  // A new key = a brand-new wizard with every field blank. It is bumped when a product is published, so even if the
  // navigator keeps this screen alive, "Add Product" can never reopen with the previous product's details (QA TC-28).
  const [formKey, setFormKey] = useState(0);
  return (
    <AdminShell title="Add Product" subtitle="Guided setup for a new catalogue item">
      <ProductWizard key={formKey} mode="create" onPublished={() => setFormKey((k) => k + 1)} />
    </AdminShell>
  );
}
