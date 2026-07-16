"use client";
import { useActionState, useRef } from "react";
import { createTeamMember, type TeamMemberState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TeamMemberForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    async (prevState, formData) => {
      const result = await createTeamMember(prevState, formData);
      if (result?.success) formRef.current?.reset();
      return result;
    },
    undefined
  );

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border bg-white p-4">
      <div className="space-y-1.5">
        <Label htmlFor="full_name">ชื่อ-นามสกุล</Label>
        <Input id="full_name" name="full_name" type="text" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">ตำแหน่ง</Label>
        <select
          id="role"
          name="role"
          required
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pin">PIN 6 หลัก</Label>
          <Input id="pin" name="pin" type="password" inputMode="numeric" maxLength={6} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pin_confirm">ยืนยัน PIN</Label>
          <Input
            id="pin_confirm"
            name="pin_confirm"
            type="password"
            inputMode="numeric"
            maxLength={6}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="recovery_contact">ช่องทางติดต่อ (ไม่บังคับ)</Label>
        <Input id="recovery_contact" name="recovery_contact" type="text" />
      </div>
      {state?.error !== undefined && (
        <p className="text-sm text-destructive font-medium">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-success font-medium">เพิ่มพนักงานสำเร็จ</p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="w-full bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "กำลังบันทึก…" : "+ เพิ่มพนักงาน"}
      </Button>
    </form>
  );
}
