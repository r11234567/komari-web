const {test,expect}=require('@playwright/test');
test('dark terminal menus retain contrast, working submenus and per-machine lock',async({page})=>{
 await page.goto('/tests/browser/fixtures/workbench.html');
 const tab=page.getByRole('tab',{name:'Synthetic Debian'});
 await expect(tab).toBeVisible();
 await tab.click({button:'right'});
 const menu=page.getByRole('menu').first();await expect(menu).toBeVisible();
 const color=page.getByRole('menuitem',{name:'更改选项卡颜色'});await color.hover();
 await expect(page.getByRole('button',{name:'#dc143c',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'#dc143c',exact:true}).click();
 await expect(tab.locator('div').first()).toHaveCSS('background-color','rgb(220, 20, 60)');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await tab.click({button:'right'});
 await page.getByRole('menuitem',{name:'关闭',exact:true}).hover();
 await expect(page.getByRole('menuitem',{name:'其他',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'其他',exact:true}).click();
 await expect(page.getByRole('tab')).toHaveCount(1);
 await tab.click({button:'right'});
 const lock=page.getByRole('menuitem',{name:'锁定此机器工作台'});
 const style=await lock.evaluate(e=>({color:getComputedStyle(e).color,bg:getComputedStyle(e.closest('[role="menu"]')).backgroundColor}));
 expect(style.color).not.toBe('rgb(28, 32, 36)');
 await lock.click();await expect(page.getByText('工作台已锁定',{exact:true})).toBeVisible();
 await page.screenshot({path:'ci-artifacts/workbench-lock.png'});
});

test('server picker stays readable and English unlock is consistently localized',async({page})=>{
 await page.goto('/tests/browser/fixtures/workbench.html?lang=en');
 await page.getByRole('button',{name:'Open terminal',exact:true}).click();
 const node=page.getByRole('menuitem',{name:/Synthetic Debian/});
 await expect(node).toBeVisible();
 expect(await node.evaluate(e=>getComputedStyle(e).color)).not.toBe('rgb(28, 32, 36)');
 await page.keyboard.press('Escape');
 await page.goto('/tests/browser/fixtures/workbench.html?locked=1&lang=en');
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('heading',{name:'Unlock terminal and files'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Verify and unlock',exact:true})).toBeVisible();
 expect(await dialog.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
});
test('padded xterm fits the viewport at multiple sizes and unlock follows dark terminal',async({page})=>{
 for(const [width,height]of [[1280,720],[800,500],[430,700]]){
 await page.setViewportSize({width,height});await page.goto('/tests/browser/fixtures/workbench.html');
 await expect.poll(()=>page.evaluate(()=>window.terminalAudit.api?.terminal.rows||0)).toBeGreaterThan(1);
 await expect.poll(()=>page.evaluate(()=>{const screen=document.querySelector('.xterm-screen')?.getBoundingClientRect();return !!screen&&screen.bottom<=innerHeight&&screen.right<=innerWidth})).toBe(true);
 }
 await page.goto('/tests/browser/fixtures/workbench.html?locked=1');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(e=>!!e.closest('.dark'))).toBe(true);
 const box=await dialog.boundingBox();expect(box.width).toBeLessThanOrEqual(400);expect(box.height).toBeLessThan(520);
 await page.screenshot({path:'ci-artifacts/workbench-unlock.png'});
});
