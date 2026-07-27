export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      channel_inventory_reports: {
        Row: {
          channel_id: string
          id: number
          product_id: string
          reported_at: string
          reported_qty: number
        }
        Insert: {
          channel_id: string
          id?: never
          product_id: string
          reported_at?: string
          reported_qty: number
        }
        Update: {
          channel_id?: string
          id?: never
          product_id?: string
          reported_at?: string
          reported_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_inventory_reports_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_inventory_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "channel_inventory_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_inventory_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "channel_inventory_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      channel_listings: {
        Row: {
          active: boolean
          channel_id: string
          external_sku: string
          id: string
          product_id: string
        }
        Insert: {
          active?: boolean
          channel_id: string
          external_sku: string
          id?: string
          product_id: string
        }
        Update: {
          active?: boolean
          channel_id?: string
          external_sku?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_listings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "channel_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "channel_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      channels: {
        Row: {
          display_name: string
          id: string
        }
        Insert: {
          display_name: string
          id: string
        }
        Update: {
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      fee_schedules: {
        Row: {
          brand_id: string | null
          category: string | null
          channel_id: string
          created_at: string
          effective_from: string
          effective_until: string | null
          fee_flat_cents: number
          fee_pct_bps: number
          id: string
          product_id: string | null
        }
        Insert: {
          brand_id?: string | null
          category?: string | null
          channel_id: string
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          fee_flat_cents?: number
          fee_pct_bps: number
          id?: string
          product_id?: string | null
        }
        Update: {
          brand_id?: string | null
          category?: string | null
          channel_id?: string
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          fee_flat_cents?: number
          fee_pct_bps?: number
          id?: string
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_schedules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "fee_schedules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_schedules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "fee_schedules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "fee_schedules_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_schedules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fee_schedules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_schedules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fee_schedules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      landed_costs: {
        Row: {
          duties_cents: number
          freight_cents: number
          handling_cents: number
          id: string
          landed_unit_cents: number | null
          product_id: string
          qty: number
          receipt_id: string
          received_at: string
          unit_cost_cents: number
        }
        Insert: {
          duties_cents?: number
          freight_cents?: number
          handling_cents?: number
          id?: string
          landed_unit_cents?: number | null
          product_id: string
          qty: number
          receipt_id: string
          received_at?: string
          unit_cost_cents: number
        }
        Update: {
          duties_cents?: number
          freight_cents?: number
          handling_cents?: number
          id?: string
          landed_unit_cents?: number | null
          product_id?: string
          qty?: number
          receipt_id?: string
          received_at?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "landed_costs_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          created_at: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: []
      }
      margin_snapshots: {
        Row: {
          computed_at: string
          fee_cents: number
          gross_revenue_cents: number
          landed_cost_cents: number
          net_margin_cents: number | null
          order_id: string
          order_line_id: string
        }
        Insert: {
          computed_at?: string
          fee_cents: number
          gross_revenue_cents: number
          landed_cost_cents: number
          net_margin_cents?: number | null
          order_id: string
          order_line_id: string
        }
        Update: {
          computed_at?: string
          fee_cents?: number
          gross_revenue_cents?: number
          landed_cost_cents?: number
          net_margin_cents?: number | null
          order_id?: string
          order_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "margin_snapshots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "margin_snapshots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "recent_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "margin_snapshots_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: true
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          id: string
          order_id: string
          product_id: string
          qty: number
          unit_price_cents: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          qty: number
          unit_price_cents: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          qty?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "recent_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      orders: {
        Row: {
          brand_id: string
          buyer_handle: string | null
          channel_id: string
          created_at: string
          external_order_id: string
          id: string
          placed_at: string
          raw_payload: Json | null
          status: string
          subtotal_cents: number
        }
        Insert: {
          brand_id: string
          buyer_handle?: string | null
          channel_id: string
          created_at?: string
          external_order_id: string
          id?: string
          placed_at: string
          raw_payload?: Json | null
          status?: string
          subtotal_cents?: number
        }
        Update: {
          brand_id?: string
          buyer_handle?: string | null
          channel_id?: string
          created_at?: string
          external_order_id?: string
          id?: string
          placed_at?: string
          raw_payload?: Json | null
          status?: string
          subtotal_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: number
          last_error: string | null
          next_attempt_at: string
          payload: Json
          status: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: never
          last_error?: string | null
          next_attempt_at?: string
          payload: Json
          status?: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: never
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand_id: string
          cost_cents: number
          created_at: string
          id: string
          price_cents: number
          sku: string
          title: string
        }
        Insert: {
          brand_id: string
          cost_cents: number
          created_at?: string
          id?: string
          price_cents: number
          sku: string
          title: string
        }
        Update: {
          brand_id?: string
          cost_cents?: number
          created_at?: string
          id?: string
          price_cents?: number
          sku?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          id: string
          product_id: string
          purchase_order_id: string
          qty_ordered: number
          unit_cost_cents: number
        }
        Insert: {
          id?: string
          product_id: string
          purchase_order_id: string
          qty_ordered: number
          unit_cost_cents: number
        }
        Update: {
          id?: string
          product_id?: string
          purchase_order_id?: string
          qty_ordered?: number
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders_dashboard"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          brand_id: string
          created_at: string
          expected_at: string | null
          id: string
          status: string
          supplier: string | null
          supplier_id: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          expected_at?: string | null
          id?: string
          status?: string
          supplier?: string | null
          supplier_id?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          expected_at?: string | null
          id?: string
          status?: string
          supplier?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          id: string
          location_id: string
          purchase_order_line_id: string
          qty_received: number
          received_at: string
          received_by: string
        }
        Insert: {
          id?: string
          location_id: string
          purchase_order_line_id: string
          qty_received: number
          received_at?: string
          received_by?: string
        }
        Update: {
          id?: string
          location_id?: string
          purchase_order_line_id?: string
          qty_received?: number
          received_at?: string
          received_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_findings: {
        Row: {
          actual: number
          channel_id: string | null
          created_at: string
          delta: number
          expected: number
          id: number
          kind: string
          location_id: string | null
          product_id: string
          run_id: string
          status: string
        }
        Insert: {
          actual: number
          channel_id?: string | null
          created_at?: string
          delta: number
          expected: number
          id?: never
          kind: string
          location_id?: string | null
          product_id: string
          run_id: string
          status?: string
        }
        Update: {
          actual?: number
          channel_id?: string | null
          created_at?: string
          delta?: number
          expected?: number
          id?: never
          kind?: string
          location_id?: string | null
          product_id?: string
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_findings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "recent_recon_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          findings_count: number | null
          finished_at: string | null
          id: string
          started_at: string
        }
        Insert: {
          findings_count?: number | null
          finished_at?: string | null
          id?: string
          started_at?: string
        }
        Update: {
          findings_count?: number | null
          finished_at?: string | null
          id?: string
          started_at?: string
        }
        Relationships: []
      }
      reorder_points: {
        Row: {
          auto_generated: boolean
          location_id: string
          min_qty: number
          product_id: string
          target_qty: number
          updated_at: string
          velocity_window: string
        }
        Insert: {
          auto_generated?: boolean
          location_id: string
          min_qty: number
          product_id: string
          target_qty: number
          updated_at?: string
          velocity_window?: string
        }
        Update: {
          auto_generated?: boolean
          location_id?: string
          min_qty?: number
          product_id?: string
          target_qty?: number
          updated_at?: string
          velocity_window?: string
        }
        Relationships: [
          {
            foreignKeyName: "reorder_points_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_points_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reorder_points_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_points_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reorder_points_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      stock_levels: {
        Row: {
          committed: number
          location_id: string
          on_hand: number
          product_id: string
        }
        Insert: {
          committed?: number
          location_id: string
          on_hand?: number
          product_id: string
        }
        Update: {
          committed?: number
          location_id?: string
          on_hand?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string
          id: number
          location_id: string
          note: string | null
          product_id: string
          qty_delta: number
          reason: string
          ref_id: string | null
          ref_type: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: never
          location_id: string
          note?: string | null
          product_id: string
          qty_delta: number
          reason: string
          ref_id?: string | null
          ref_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: never
          location_id?: string
          note?: string | null
          product_id?: string
          qty_delta?: number
          reason?: string
          ref_id?: string | null
          ref_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          lead_time_days: number
          moq: number
          product_id: string
          supplier_id: string
          supplier_sku: string | null
          unit_cost_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          lead_time_days: number
          moq?: number
          product_id: string
          supplier_id: string
          supplier_sku?: string | null
          unit_cost_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          lead_time_days?: number
          moq?: number
          product_id?: string
          supplier_id?: string
          supplier_sku?: string | null
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          attempts: number
          channel_id: string
          event_type: string
          external_event_id: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          signature_valid: boolean
          status: string
        }
        Insert: {
          attempts?: number
          channel_id: string
          event_type: string
          external_event_id: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          signature_valid: boolean
          status?: string
        }
        Update: {
          attempts?: number
          channel_id?: string
          event_type?: string
          external_event_id?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          signature_valid?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      aged_inventory: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          days_since_last_shipment: number | null
          dollars_at_risk_cents: number | null
          last_shipped_at: string | null
          location_id: string | null
          location_name: string | null
          on_hand: number | null
          product_id: string | null
          sku: string | null
          title: string | null
          unit_cost_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      available_to_sell: {
        Row: {
          available: number | null
          product_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      current_stock_from_ledger: {
        Row: {
          location_id: string | null
          on_hand_ledger: number | null
          product_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
        ]
      }
      dashboard_summary: {
        Row: {
          backordered_count: number | null
          dead_count: number | null
          dlq_count: number | null
          failed_count: number | null
          gmv_cents: number | null
          orders_count: number | null
          processed_count: number | null
          received_count: number | null
          returned_count: number | null
          shipped_count: number | null
        }
        Relationships: []
      }
      dlq_events: {
        Row: {
          attempts: number | null
          channel_id: string | null
          event_type: string | null
          external_event_id: string | null
          external_order_id: string | null
          id: string | null
          last_error: string | null
          payload: Json | null
          processed_at: string | null
          received_at: string | null
          signature_valid: boolean | null
          status: string | null
        }
        Insert: {
          attempts?: number | null
          channel_id?: string | null
          event_type?: string | null
          external_event_id?: string | null
          external_order_id?: never
          id?: string | null
          last_error?: string | null
          payload?: Json | null
          processed_at?: string | null
          received_at?: string | null
          signature_valid?: boolean | null
          status?: string | null
        }
        Update: {
          attempts?: number | null
          channel_id?: string | null
          event_type?: string | null
          external_event_id?: string | null
          external_order_id?: never
          id?: string | null
          last_error?: string | null
          payload?: Json | null
          processed_at?: string | null
          received_at?: string | null
          signature_valid?: boolean | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      gmv_today: {
        Row: {
          brand_id: string | null
          channel_id: string | null
          gmv_cents: number | null
          orders_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_counters_today: {
        Row: {
          dead_count: number | null
          failed_count: number | null
          processed_count: number | null
          received_count: number | null
          total_count: number | null
        }
        Relationships: []
      }
      landed_cost_history: {
        Row: {
          brand_name: string | null
          duties_cents: number | null
          freight_cents: number | null
          handling_cents: number | null
          id: string | null
          landed_unit_cents: number | null
          location_id: string | null
          location_name: string | null
          product_id: string | null
          qty: number | null
          receipt_id: string | null
          received_at: string | null
          sku: string | null
          title: string | null
          unit_cost_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "landed_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "landed_costs_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      open_findings: {
        Row: {
          actual: number | null
          brand_name: string | null
          channel_id: string | null
          created_at: string | null
          delta: number | null
          expected: number | null
          id: number | null
          kind: string | null
          location_id: string | null
          location_name: string | null
          product_id: string | null
          run_id: string | null
          sku: string | null
          status: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_findings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "reconciliation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "recent_recon_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders_dashboard: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          created_at: string | null
          days_outstanding: number | null
          expected_at: string | null
          id: string | null
          line_count: number | null
          qty_ordered: number | null
          qty_received: number | null
          receive_fraction: number | null
          status: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_cost_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "purchase_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_orders: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          buyer_handle: string | null
          channel_id: string | null
          created_at: string | null
          external_order_id: string | null
          id: string | null
          placed_at: string | null
          status: string | null
          subtotal_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "aged_inventory"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "sku_margin_by_channel"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "stock_dashboard"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_recon_runs: {
        Row: {
          elapsed_ms: number | null
          findings_count: number | null
          finished_at: string | null
          id: string | null
          started_at: string | null
        }
        Relationships: []
      }
      replenishment_alerts: {
        Row: {
          available: number | null
          brand_id: string | null
          brand_name: string | null
          committed: number | null
          days_of_cover: number | null
          location_id: string | null
          location_name: string | null
          min_qty: number | null
          on_hand: number | null
          primary_lead_time_days: number | null
          primary_moq: number | null
          primary_supplier_id: string | null
          primary_supplier_name: string | null
          primary_unit_cost_cents: number | null
          product_id: string | null
          recommended_qty: number | null
          sku: string | null
          target_qty: number | null
          title: string | null
          units_shipped_window: number | null
          urgency: string | null
          velocity_per_day: number | null
          velocity_window: string | null
        }
        Relationships: []
      }
      sku_margin_by_channel: {
        Row: {
          avg_fee_cents: number | null
          avg_gross_revenue_cents: number | null
          avg_landed_cost_cents: number | null
          avg_net_margin_cents: number | null
          brand_id: string | null
          brand_name: string | null
          channel_id: string | null
          net_margin_pct: number | null
          orders_in_window: number | null
          product_id: string | null
          sku: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_dashboard: {
        Row: {
          available: number | null
          brand_id: string | null
          brand_name: string | null
          committed: number | null
          cost_cents: number | null
          location_id: string | null
          location_name: string | null
          low_stock: boolean | null
          on_hand: number | null
          price_cents: number | null
          product_id: string | null
          sku: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _apply_order_cancelled: {
        Args: { p_channel_id: string; p_location_id: string; p_payload: Json }
        Returns: {
          order_id: string
          outcome: string
        }[]
      }
      _apply_order_created: {
        Args: { p_channel_id: string; p_location_id: string; p_payload: Json }
        Returns: {
          order_id: string
          outcome: string
        }[]
      }
      _apply_order_returned: {
        Args: { p_channel_id: string; p_location_id: string; p_payload: Json }
        Returns: {
          order_id: string
          outcome: string
        }[]
      }
      _apply_order_shipped: {
        Args: { p_channel_id: string; p_location_id: string; p_payload: Json }
        Returns: {
          order_id: string
          outcome: string
        }[]
      }
      _avg_landed_unit: { Args: { p_product_id: string }; Returns: number }
      _fee_for_line: {
        Args: {
          p_at: string
          p_brand_id: string
          p_channel_id: string
          p_gross_cents: number
          p_product_id: string
        }
        Returns: number
      }
      _write_margin_snapshot: {
        Args: { p_order_line_id: string }
        Returns: undefined
      }
      allocate_order: {
        Args: { p_location_id: string; p_order_id: string }
        Returns: string
      }
      cancel_order: {
        Args: { p_location_id: string; p_order_id: string }
        Returns: undefined
      }
      close_purchase_order: {
        Args: { p_po_id: string; p_reason?: string }
        Returns: Json
      }
      compute_reorder_signals: {
        Args: { p_brand_id?: string; p_location_id: string }
        Returns: {
          available: number
          brand_id: string
          brand_name: string
          committed: number
          days_of_cover: number
          location_id: string
          location_name: string
          min_qty: number
          on_hand: number
          primary_lead_time_days: number
          primary_moq: number
          primary_supplier_id: string
          primary_supplier_name: string
          primary_unit_cost_cents: number
          product_id: string
          recommended_qty: number
          sku: string
          target_qty: number
          title: string
          units_shipped_window: number
          urgency: string
          velocity_per_day: number
          velocity_window: string
        }[]
      }
      create_purchase_order: {
        Args: {
          p_brand_id: string
          p_created_by?: string
          p_expected_at?: string
          p_lines?: Json
          p_supplier_id: string
        }
        Returns: string
      }
      outbox_deliver_batch: {
        Args: { p_limit?: number }
        Returns: {
          aggregate_id: string
          event_type: string
          id: number
          payload: Json
        }[]
      }
      outbox_mark_failed: {
        Args: { p_error: string; p_id: number; p_max_attempts?: number }
        Returns: string
      }
      process_order_event: {
        Args: {
          p_channel_id: string
          p_event_type: string
          p_external_event_id: string
          p_location_id: string
          p_payload: Json
          p_signature_valid: boolean
        }
        Returns: Json
      }
      receive_po_line: {
        Args: {
          p_by?: string
          p_location_id: string
          p_po_line_id: string
          p_qty: number
        }
        Returns: string
      }
      receive_shipment: {
        Args: {
          p_duties_cents?: number
          p_freight_cents?: number
          p_handling_cents?: number
          p_location_id: string
          p_po_line_id: string
          p_qty: number
          p_received_by?: string
          p_unit_cost_cents: number
        }
        Returns: string
      }
      resolve_reconciliation_finding: {
        Args: { p_finding_id: number }
        Returns: Json
      }
      retry_webhook_event: {
        Args: { p_event_id: string; p_location_id: string }
        Returns: Json
      }
      run_reconciliation: { Args: never; Returns: string }
      ship_order: {
        Args: { p_location_id: string; p_order_id: string }
        Returns: undefined
      }
      skew_channel_report: {
        Args: { p_channel_id: string; p_delta: number; p_sku: string }
        Returns: Json
      }
      upsert_reorder_point: {
        Args: {
          p_location_id: string
          p_min_qty: number
          p_product_id: string
          p_target_qty: number
          p_velocity_window?: string
        }
        Returns: Json
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

