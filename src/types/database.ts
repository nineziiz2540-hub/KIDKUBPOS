export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          direction: string
          id: string
          note: string | null
          reason: string
          shift_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          direction: string
          id?: string
          note?: string | null
          reason: string
          shift_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          direction?: string
          id?: string
          note?: string | null
          reason?: string
          shift_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          sort_order: number
          created_at: string
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          sort_order?: number
          created_at?: string
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          sort_order?: number
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      choice_group_members: {
        Row: {
          group_id: string
          id: string
          is_default: boolean
          label: string
          price_delta: number
          raw_material_id: string
          sort_order: number
          tenant_id: string
          tier: string
        }
        Insert: {
          group_id: string
          id?: string
          is_default?: boolean
          label: string
          price_delta?: number
          raw_material_id: string
          sort_order?: number
          tenant_id: string
          tier: string
        }
        Update: {
          group_id?: string
          id?: string
          is_default?: boolean
          label?: string
          price_delta?: number
          raw_material_id?: string
          sort_order?: number
          tenant_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "choice_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "choice_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "choice_group_members_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "choice_group_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      choice_groups: {
        Row: {
          created_at: string | null
          id: string
          kind: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kind: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kind?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "choice_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      held_bill_events: {
        Row: {
          actor_id: string
          created_at: string
          detail: Json | null
          event_type: string
          held_bill_id: string
          id: string
          tenant_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          detail?: Json | null
          event_type: string
          held_bill_id: string
          id?: string
          tenant_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          detail?: Json | null
          event_type?: string
          held_bill_id?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_bill_events_held_bill_id_fkey"
            columns: ["held_bill_id"]
            isOneToOne: false
            referencedRelation: "held_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      held_bills: {
        Row: {
          business_date: string
          cancel_reason: string | null
          cancelled_approved_by: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          customer_label: string | null
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          items: Json
          order_type: string
          queue_number: number
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          business_date: string
          cancel_reason?: string | null
          cancelled_approved_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          customer_label?: string | null
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          items: Json
          order_type?: string
          queue_number: number
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          business_date?: string
          cancel_reason?: string | null
          cancelled_approved_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          customer_label?: string | null
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          items?: Json
          order_type?: string
          queue_number?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "held_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          legacy: boolean
          note: string | null
          occurred_at: string
          order_id: string | null
          order_item_id: string | null
          quantity: number
          raw_material_id: string
          reason: string | null
          ref_id: string | null
          tenant_id: string
          type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          legacy?: boolean
          note?: string | null
          occurred_at?: string
          order_id?: string | null
          order_item_id?: string | null
          quantity: number
          raw_material_id: string
          reason?: string | null
          ref_id?: string | null
          tenant_id: string
          type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          legacy?: boolean
          note?: string | null
          occurred_at?: string
          order_id?: string | null
          order_item_id?: string | null
          quantity?: number
          raw_material_id?: string
          reason?: string | null
          ref_id?: string | null
          tenant_id?: string
          type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      login_lockouts: {
        Row: {
          email: string
          failed_attempts: number
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          email: string
          failed_attempts?: number
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          failed_attempts?: number
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      mfa_backup_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          profile_id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          profile_id: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          profile_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_backup_codes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_option_effects: {
        Row: {
          amount: number
          group_id: string | null
          id: string
          kind: string
          option_id: string
          raw_material_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          group_id?: string | null
          id?: string
          kind: string
          option_id: string
          raw_material_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          group_id?: string | null
          id?: string
          kind?: string
          option_id?: string
          raw_material_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_option_effects_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "choice_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_effects_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_effects_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_effects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          id: string
          modifier_id: string
          name: string
          price_delta: number | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          modifier_id: string
          name: string
          price_delta?: number | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          modifier_id?: string
          name?: string
          price_delta?: number | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          created_at: string | null
          id: string
          is_multi_select: boolean
          is_required: boolean
          name: string
          sort_order: number | null
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_multi_select?: boolean
          is_required?: boolean
          name: string
          sort_order?: number | null
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_multi_select?: boolean
          is_required?: boolean
          name?: string
          sort_order?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_adjustments: {
        Row: {
          actor_id: string | null
          approver_id: string | null
          created_at: string
          from_value: string
          id: string
          kind: string
          order_id: string
          reason: string
          tenant_id: string
          to_value: string
        }
        Insert: {
          actor_id?: string | null
          approver_id?: string | null
          created_at?: string
          from_value: string
          id?: string
          kind: string
          order_id: string
          reason: string
          tenant_id: string
          to_value: string
        }
        Update: {
          actor_id?: string | null
          approver_id?: string | null
          created_at?: string
          from_value?: string
          id?: string
          kind?: string
          order_id?: string
          reason?: string
          tenant_id?: string
          to_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          category_name: string | null
          choices: Json | null
          cost_total: number | null
          created_at: string
          id: string
          modifiers_snapshot: Json | null
          note: string | null
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          subtotal: number
          unit_price: number
          void_made: boolean | null
        }
        Insert: {
          category_name?: string | null
          choices?: Json | null
          cost_total?: number | null
          created_at?: string
          id?: string
          modifiers_snapshot?: Json | null
          note?: string | null
          order_id: string
          product_id: string
          product_name: string
          quantity?: number
          subtotal: number
          unit_price: number
          void_made?: boolean | null
        }
        Update: {
          category_name?: string | null
          choices?: Json | null
          cost_total?: number | null
          created_at?: string
          id?: string
          modifiers_snapshot?: Json | null
          note?: string | null
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          subtotal?: number
          unit_price?: number
          void_made?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          bags: number
          cancel_reason: string | null
          cancelled_approved_by: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cash_received: number | null
          change_amount: number | null
          client_ref: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          discount_amount: number
          discount_approved_by: string | null
          discount_reason: string | null
          discount_type: string | null
          discount_value: number | null
          held_bill_id: string | null
          id: string
          note: string | null
          order_number: string | null
          order_type: string
          payment_method: string
          queue_number: number | null
          refund_method: string | null
          refund_reason: string | null
          refund_shift_id: string | null
          refunded_approved_by: string | null
          refunded_at: string | null
          refunded_by: string | null
          shift_id: string | null
          sold_offline: boolean
          status: string
          subtotal: number
          table_number: string | null
          tenant_id: string
          total: number
          transfer_verified_at: string | null
          transfer_verified_by: string | null
          unpaid_approved_by: string | null
          unpaid_at: string | null
          unpaid_by: string | null
          unpaid_reason: string | null
          updated_at: string
        }
        Insert: {
          bags?: number
          cancel_reason?: string | null
          cancelled_approved_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_received?: number | null
          change_amount?: number | null
          client_ref?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          discount_amount?: number
          discount_approved_by?: string | null
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          held_bill_id?: string | null
          id?: string
          note?: string | null
          order_number?: string | null
          order_type?: string
          payment_method?: string
          queue_number?: number | null
          refund_method?: string | null
          refund_reason?: string | null
          refund_shift_id?: string | null
          refunded_approved_by?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          shift_id?: string | null
          sold_offline?: boolean
          status?: string
          subtotal?: number
          table_number?: string | null
          tenant_id: string
          total?: number
          transfer_verified_at?: string | null
          transfer_verified_by?: string | null
          unpaid_approved_by?: string | null
          unpaid_at?: string | null
          unpaid_by?: string | null
          unpaid_reason?: string | null
          updated_at?: string
        }
        Update: {
          bags?: number
          cancel_reason?: string | null
          cancelled_approved_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_received?: number | null
          change_amount?: number | null
          client_ref?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          discount_amount?: number
          discount_approved_by?: string | null
          discount_reason?: string | null
          discount_type?: string | null
          discount_value?: number | null
          held_bill_id?: string | null
          id?: string
          note?: string | null
          order_number?: string | null
          order_type?: string
          payment_method?: string
          queue_number?: number | null
          refund_method?: string | null
          refund_reason?: string | null
          refund_shift_id?: string | null
          refunded_approved_by?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          shift_id?: string | null
          sold_offline?: boolean
          status?: string
          subtotal?: number
          table_number?: string | null
          tenant_id?: string
          total?: number
          transfer_verified_at?: string | null
          transfer_verified_by?: string | null
          unpaid_approved_by?: string | null
          unpaid_at?: string | null
          unpaid_by?: string | null
          unpaid_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_cancelled_approved_by_fkey"
            columns: ["cancelled_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_discount_approved_by_fkey"
            columns: ["discount_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_refund_shift_id_fkey"
            columns: ["refund_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_refunded_approved_by_fkey"
            columns: ["refunded_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_set_items: {
        Row: {
          id: string
          qty: number
          raw_material_id: string
          set_id: string
          tenant_id: string
        }
        Insert: {
          id?: string
          qty: number
          raw_material_id: string
          set_id: string
          tenant_id: string
        }
        Update: {
          id?: string
          qty?: number
          raw_material_id?: string
          set_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_set_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_set_items_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "packaging_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_set_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_sets: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_sets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_modifiers: {
        Row: {
          id: string
          modifier_id: string
          product_id: string
          tenant_id: string
        }
        Insert: {
          id?: string
          modifier_id: string
          product_id: string
          tenant_id: string
        }
        Update: {
          id?: string
          modifier_id?: string
          product_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipes: {
        Row: {
          allow_special: boolean
          default_member_id: string | null
          group_id: string | null
          id: string
          line_kind: string
          product_id: string
          quantity_used: number
          raw_material_id: string | null
          tenant_id: string
        }
        Insert: {
          allow_special?: boolean
          default_member_id?: string | null
          group_id?: string | null
          id?: string
          line_kind?: string
          product_id: string
          quantity_used: number
          raw_material_id?: string | null
          tenant_id: string
        }
        Update: {
          allow_special?: boolean
          default_member_id?: string | null
          group_id?: string | null
          id?: string
          line_kind?: string
          product_id?: string
          quantity_used?: number
          raw_material_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_recipes_default_member_id_fkey"
            columns: ["default_member_id"]
            isOneToOne: false
            referencedRelation: "choice_group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "choice_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipes_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sweetness: {
        Row: {
          allowed_member_ids: string[]
          default_level_id: string | null
          default_member_id: string
          group_id: string
          product_id: string
          tenant_id: string
          use_custom: boolean
        }
        Insert: {
          allowed_member_ids?: string[]
          default_level_id?: string | null
          default_member_id: string
          group_id: string
          product_id: string
          tenant_id: string
          use_custom?: boolean
        }
        Update: {
          allowed_member_ids?: string[]
          default_level_id?: string | null
          default_member_id?: string
          group_id?: string
          product_id?: string
          tenant_id?: string
          use_custom?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "product_sweetness_default_level_id_fkey"
            columns: ["default_level_id"]
            isOneToOne: false
            referencedRelation: "sweetness_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sweetness_default_member_id_fkey"
            columns: ["default_member_id"]
            isOneToOne: false
            referencedRelation: "choice_group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sweetness_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "choice_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sweetness_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sweetness_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          sort_order: number
          archived_at: string | null
          category_id: string | null
          created_at: string
          description: string | null
          drink_type: string | null
          house_glass_default: boolean
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          packaging_set_id: string | null
          paused_at: string | null
          paused_by: string | null
          price: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          sort_order?: number
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          drink_type?: string | null
          house_glass_default?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          packaging_set_id?: string | null
          paused_at?: string | null
          paused_by?: string | null
          price?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          sort_order?: number
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          drink_type?: string | null
          house_glass_default?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          packaging_set_id?: string | null
          paused_at?: string | null
          paused_by?: string | null
          price?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_packaging_set_tenant_fkey"
            columns: ["packaging_set_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "packaging_sets"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "products_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_managed: boolean
          created_at: string
          deactivated_at: string | null
          full_name: string | null
          has_backup_password: boolean
          id: string
          pin_failed_attempts: number
          pin_hash: string | null
          pin_locked_until: string | null
          recovery_contact: string | null
          role: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auth_managed?: boolean
          created_at?: string
          deactivated_at?: string | null
          full_name?: string | null
          has_backup_password?: boolean
          id: string
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          recovery_contact?: string | null
          role?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auth_managed?: boolean
          created_at?: string
          deactivated_at?: string | null
          full_name?: string | null
          has_backup_password?: boolean
          id?: string
          pin_failed_attempts?: number
          pin_hash?: string | null
          pin_locked_until?: string | null
          recovery_contact?: string | null
          role?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_materials: {
        Row: {
          archived_at: string | null
          category: string
          cost_per_unit: number
          created_at: string | null
          current_stock: number
          id: string
          min_stock_alert: number
          name: string
          purchase_size: number | null
          purchase_unit: string | null
          tenant_id: string
          track_stock: boolean
          unit: string
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          category?: string
          cost_per_unit?: number
          created_at?: string | null
          current_stock?: number
          id?: string
          min_stock_alert?: number
          name: string
          purchase_size?: number | null
          purchase_unit?: string | null
          tenant_id: string
          track_stock?: boolean
          unit: string
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          category?: string
          cost_per_unit?: number
          created_at?: string | null
          current_stock?: number
          id?: string
          min_stock_alert?: number
          name?: string
          purchase_size?: number | null
          purchase_unit?: string | null
          tenant_id?: string
          track_stock?: boolean
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_materials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_cash_counts: {
        Row: {
          amount: number
          attempt: number
          created_at: string
          created_by: string
          expected: number | null
          id: string
          shift_id: string
          stage: string
          tenant_id: string
        }
        Insert: {
          amount: number
          attempt: number
          created_at?: string
          created_by: string
          expected?: number | null
          id?: string
          shift_id: string
          stage: string
          tenant_id: string
        }
        Update: {
          amount?: number
          attempt?: number
          created_at?: string
          created_by?: string
          expected?: number | null
          id?: string
          shift_id?: string
          stage?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_cash_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_cash_counts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_cash_counts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_cash_counted: number | null
          closing_cash_in: number | null
          closing_cash_out: number | null
          closing_cash_refunds: number | null
          closing_cash_sales: number | null
          closing_note: string | null
          closing_order_count: number | null
          closing_transfer_sales: number | null
          created_at: string
          deposit_amount: number | null
          expected_cash: number | null
          float_left: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_cash: number
          opening_difference: number | null
          opening_expected: number | null
          opening_note: string | null
          previous_shift_id: string | null
          status: string
          tenant_id: string
          variance: number | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_cash_counted?: number | null
          closing_cash_in?: number | null
          closing_cash_out?: number | null
          closing_cash_refunds?: number | null
          closing_cash_sales?: number | null
          closing_note?: string | null
          closing_order_count?: number | null
          closing_transfer_sales?: number | null
          created_at?: string
          deposit_amount?: number | null
          expected_cash?: number | null
          float_left?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_cash?: number
          opening_difference?: number | null
          opening_expected?: number | null
          opening_note?: string | null
          previous_shift_id?: string | null
          status?: string
          tenant_id: string
          variance?: number | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_cash_counted?: number | null
          closing_cash_in?: number | null
          closing_cash_out?: number | null
          closing_cash_refunds?: number | null
          closing_cash_sales?: number | null
          closing_note?: string | null
          closing_order_count?: number | null
          closing_transfer_sales?: number | null
          created_at?: string
          deposit_amount?: number | null
          expected_cash?: number | null
          float_left?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_cash?: number
          opening_difference?: number | null
          opening_expected?: number | null
          opening_note?: string | null
          previous_shift_id?: string | null
          status?: string
          tenant_id?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_previous_shift_id_fkey"
            columns: ["previous_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_flags: {
        Row: {
          business_date: string
          created_at: string
          created_by: string | null
          detail: string | null
          id: string
          kind: string
          order_id: string | null
          product_id: string | null
          raw_material_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          tenant_id: string
        }
        Insert: {
          business_date: string
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          kind: string
          order_id?: string | null
          product_id?: string | null
          raw_material_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          tenant_id: string
        }
        Update: {
          business_date?: string
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          kind?: string
          order_id?: string | null
          product_id?: string | null
          raw_material_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_flags_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_flags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_flags_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sweetness_amounts: {
        Row: {
          amount: number
          id: string
          level_id: string
          member_id: string
          product_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          id?: string
          level_id: string
          member_id: string
          product_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          id?: string
          level_id?: string
          member_id?: string
          product_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sweetness_amounts_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "sweetness_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sweetness_amounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "choice_group_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sweetness_amounts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sweetness_amounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sweetness_levels: {
        Row: {
          id: string
          is_default: boolean
          is_none: boolean
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          id?: string
          is_default?: boolean
          is_none?: boolean
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          id?: string
          is_default?: boolean
          is_none?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sweetness_levels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_queue_counters: {
        Row: {
          business_date: string
          last_number: number
          tenant_id: string
        }
        Insert: {
          business_date: string
          last_number?: number
          tenant_id: string
        }
        Update: {
          business_date?: string
          last_number?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_queue_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          bag_material_id: string | null
          bags_per_cups: number | null
          cash_float_default: number
          created_at: string
          delivery_gp_percent: number
          fixed_cost_monthly: number
          id: string
          logo_url: string | null
          name: string
          order_prefix: string
          order_sequence: number
          promptpay_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          bag_material_id?: string | null
          bags_per_cups?: number | null
          cash_float_default?: number
          created_at?: string
          delivery_gp_percent?: number
          fixed_cost_monthly?: number
          id?: string
          logo_url?: string | null
          name: string
          order_prefix?: string
          order_sequence?: number
          promptpay_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          bag_material_id?: string | null
          bags_per_cups?: number | null
          cash_float_default?: number
          created_at?: string
          delivery_gp_percent?: number
          fixed_cost_monthly?: number
          id?: string
          logo_url?: string | null
          name?: string
          order_prefix?: string
          order_sequence?: number
          promptpay_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_bag_material_tenant_fkey"
            columns: ["bag_material_id", "id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_role: { Args: never; Returns: string }
      auth_tenant_id: { Args: never; Returns: string }
      caller_has_verified_mfa_factor: { Args: never; Returns: boolean }
      create_tenant_and_owner: {
        Args: {
          p_has_backup_password?: boolean
          p_store_name: string
          p_user_id: string
        }
        Returns: string
      }
      generate_order_number: { Args: { p_tenant_id: string }; Returns: string }
      next_queue_number: { Args: { p_tenant_id: string }; Returns: number }
      order_change_payment_method: {
        Args: {
          p_actor_id: string
          p_approver_id: string
          p_order_id: string
          p_reason: string
          p_tenant_id: string
          p_to_method: string
        }
        Returns: undefined
      }
      order_mark_unpaid: {
        Args: {
          p_actor_id: string
          p_approver_id: string
          p_order_id: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      order_record: {
        Args: {
          p_actor_id: string
          p_client_ref: string
          p_held_bill_id: string | null
          p_held_bill_version: number | null
          p_held_reductions: Json
          p_items: Json
          p_offline: Json | null
          p_order: Json
          p_tenant_id: string
        }
        Returns: {
          cash_received: number
          change_amount: number
          created: boolean
          order_id: string
          order_number: string
          queue_number: number
        }[]
      }
      order_restore_paid: {
        Args: {
          p_actor_id: string
          p_approver_id: string
          p_order_id: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      order_set_transfer_verified: {
        Args: {
          p_actor_id: string
          p_order_id: string
          p_tenant_id: string
          p_verified: boolean
        }
        Returns: undefined
      }
      order_void: {
        Args: {
          p_actor_id: string
          p_approver_id: string
          p_made: Json
          p_order_id: string
          p_reason: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      queue_counter_raise: {
        Args: {
          p_actor_id: string
          p_business_date: string
          p_queue_number: number
          p_tenant_id: string
        }
        Returns: undefined
      }
      reorder_categories: { Args: { p_ids: string[] }; Returns: undefined }
      receipt_get: {
        Args: { p_token: string }
        Returns: Json
      }
      set_menu_paused: {
        Args: {
          p_actor_id: string
          p_paused: boolean
          p_product_id: string
          p_tenant_id: string
        }
        Returns: string | null
      }
      shift_add_cash_movement: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_direction: string
          p_note: string | null
          p_reason: string
          p_shift_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      shift_assert_actor: {
        Args: { p_actor_id: string; p_tenant_id: string }
        Returns: undefined
      }
      shift_close: {
        Args: {
          p_actor_id: string
          p_float_left: number
          p_note: string | null
          p_shift_id: string
          p_tenant_id: string
        }
        Returns: {
          counted: number
          deposit: number
          expected: number
          float_left: number
          variance: number
        }[]
      }
      shift_open: {
        Args: {
          p_actor_id: string
          p_counts: number[]
          p_note: string | null
          p_tenant_id: string
        }
        Returns: string
      }
      shift_record_closing_count: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_shift_id: string
          p_tenant_id: string
        }
        Returns: { attempt: number; expected: number }[]
      }
      shift_totals: {
        Args: { p_shift_id: string; p_tenant_id: string }
        Returns: {
          cash_in: number
          cash_out: number
          cash_refunds: number
          cash_sales: number
          expected_cash: number
          opening_cash: number
          order_count: number
          transfer_sales: number
        }[]
      }
      stock_adjust: {
        Args: {
          p_actor_id: string
          p_material_id: string
          p_new_balance: number
          p_reason: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      stock_flag_resolve: {
        Args: { p_actor_id: string; p_flag_id: string; p_tenant_id: string }
        Returns: undefined
      }
      stock_flag_sold_while_out: {
        Args: {
          p_actor_id: string
          p_material_ids: string[]
          p_product_id: string | null
          p_tenant_id: string
        }
        Returns: number
      }
      stock_receive: {
        Args: {
          p_actor_id: string
          p_material_id: string
          p_note: string | null
          p_qty: number
          p_tenant_id: string
          p_total_price: number | null
        }
        Returns: string
      }
      stock_receive_undo: {
        Args: { p_actor_id: string; p_ledger_id: string; p_tenant_id: string }
        Returns: undefined
      }
      stock_waste: {
        Args: {
          p_actor_id: string
          p_lines: Json
          p_reason: string
          p_ref_id: string | null
          p_tenant_id: string
        }
        Returns: undefined
      }
      stock_waste_undo: {
        Args: { p_actor_id: string; p_ref_id: string; p_tenant_id: string }
        Returns: number
      }
      reorder_products: {
        Args: { p_category_id: string | null; p_ids: string[] }
        Returns: undefined
      }
      replace_product_modifiers: {
        Args: { p_product_id: string; p_modifier_ids: string[] }
        Returns: undefined
      }
      replace_product_recipes: {
        Args: { p_product_id: string; p_rows: Json }
        Returns: undefined
      }
      save_menu: {
        Args: {
          p_id: string | null
          p_menu: Json
          p_recipes: Json
          p_modifier_ids: string[]
        }
        Returns: string
      }
      save_option_effects: {
        Args: { p_effects: Json; p_option_id: string }
        Returns: undefined
      }
      save_packaging_set: {
        Args: { p_id: string | null; p_items: Json; p_name: string }
        Returns: string
      }
      archive_packaging_set: { Args: { p_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
