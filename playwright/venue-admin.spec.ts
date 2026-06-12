import { test, expect } from '@playwright/test';

// These tests verify role-based access and functionality in the venue admin dashboard
// Run with: playwright test

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Venue Admin Dashboard', () => {
  test.describe('Admin role', () => {
    test('displays all sections (settings, members, quotas)', async ({ page }) => {
      // Navigate to venue admin page
      // In a real scenario, you'd authenticate first
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Check for venue settings section
      await expect(page.locator('text=Instellingen')).toBeVisible();

      // Check for members section
      await expect(page.locator('text=Teamleden')).toBeVisible();

      // Check for quota section
      await expect(page.locator('text=Quotum per persoon')).toBeVisible();
    });

    test('can edit venue settings', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Click edit button
      await page.click('button:has-text("Bewerken")');

      // Edit venue name
      await page.fill('input[type="text"]', 'Updated Venue Name');

      // Save
      await page.click('button:has-text("Opslaan")');

      // Check success message
      await expect(page.locator('text=Instellingen opgeslagen')).toBeVisible();
    });

    test('can invite users with roles', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Click invite button
      await page.click('button:has-text("Uitnodigen")');

      // Fill email
      await page.fill('input[type="email"]', 'newuser@example.com');

      // Select roles
      await page.click('text=Admin');
      await page.click('text=Finance');

      // Submit
      await page.click('button:has-text("Uitnodigen"):not(:has-text("Teamlid"))');

      // Check success
      await expect(page.locator('text=Teamlid uitgenodigd')).toBeVisible();
    });

    test('can edit user roles', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Click role editor for first member
      await page.click('button:has-text("Rollen")');

      // Uncheck admin, check staff
      await page.uncheck('input[value="admin"]');
      await page.check('input[value="staff"]');

      // Save
      await page.click('button:has-text("Opslaan"):not(:has-text("Teamlid"))');
    });

    test('can remove members with confirmation', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Get member count before
      const membersBefore = await page.locator('[data-testid="member-item"]').count();

      // Click remove button
      await page.click('button:has-text("Verwijderen"):first');

      // Confirm removal
      await page.click('button:has-text("Verwijderen"):not(:nth-of-type(1))');

      // Check members count decreased
      const membersAfter = await page.locator('[data-testid="member-item"]').count();
      expect(membersAfter).toBe(membersBefore - 1);
    });

    test('can set default quotas per user', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Click edit quota for first member
      const firstQuotaEdit = await page.locator('text=Wijzigen').first();
      await firstQuotaEdit.click();

      // Set quota
      await page.fill('input[type="number"]', '50');

      // Save
      await page.click('button:has-text("Opslaan"):not(:has-text("Teamlid"))');

      // Verify quota displays
      await expect(page.locator('text=50')).toBeVisible();
    });
  });

  test.describe('User Manager role', () => {
    test('can invite users and manage roles', async ({ page }) => {
      // User manager has invite and role management but not settings
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id-manager`);

      // Check invite section exists
      await expect(page.locator('text=Teamlid toevoegen')).toBeVisible();

      // Check settings section is read-only
      await expect(page.locator('button:has-text("Bewerken"):first')).not.toBeVisible();
    });

    test('cannot edit venue settings', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id-manager`);

      // Settings should show but be read-only
      const editButtons = await page.locator('button:has-text("Bewerken")').all();
      // Only role edit buttons should exist, not settings edit
      for (const button of editButtons) {
        const parent = await button.locator('..').first();
        const parentText = await parent.textContent();
        expect(parentText).not.toContain('Instellingen');
      }
    });

    test('cannot see quota manager section', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id-manager`);

      // Quota section should not be visible
      await expect(page.locator('text=Quotum per persoon')).not.toBeVisible();
    });
  });

  test.describe('Finance role', () => {
    test('displays read-only view', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id-finance`);

      // Check read-only indicator
      await expect(page.locator('text=read-only')).toBeVisible();

      // Verify no edit buttons visible
      await expect(page.locator('button:has-text("Bewerken")')).not.toBeVisible();
      await expect(page.locator('button:has-text("Uitnodigen")')).not.toBeVisible();
      await expect(page.locator('button:has-text("Wijzigen")')).not.toBeVisible();
    });

    test('can view member list and quotas', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id-finance`);

      // Should see members
      await expect(page.locator('text=Teamleden')).toBeVisible();

      // Should see quotas (read-only)
      await expect(page.locator('text=gasten')).toBeVisible();
    });
  });

  test.describe('Multi-venue switching', () => {
    test('displays switcher when user has multiple memberships', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Check for venue switcher
      await expect(page.locator('text=Locatie:')).toBeVisible();
    });

    test('navigates to different venue when switched', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id`);

      // Open switcher
      await page.selectOption('select', 'test-venue-id-2');

      // Should navigate
      await expect(page).toHaveURL(/\/admin\/venues\/test-venue-id-2/);
    });
  });

  test.describe('Access control', () => {
    test('non-member cannot access venue admin', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin/venues/non-member-venue`, {
        waitUntil: 'networkidle',
      });

      // Should show 404
      await expect(page.locator('text=404')).toBeVisible();
    });

    test('non-admin cannot access without proper role', async ({ page }) => {
      // Staff member trying to access admin page
      await page.goto(`${BASE_URL}/admin/venues/test-venue-id-staff`, {
        waitUntil: 'networkidle',
      });

      // Should show 404
      await expect(page.locator('text=404')).toBeVisible();
    });
  });
});
